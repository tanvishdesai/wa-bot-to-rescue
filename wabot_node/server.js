require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Client, LocalAuth } = require('whatsapp-web.js');

const connectDB = require('./db');
const authRoutes = require('./routes/auth');
const authMiddleware = require('./middleware/auth');

// ─── App Setup ───────────────────────────────────────────────
const app = express();

const allowedOrigins = [
    'http://localhost:3000',
    process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true); // Be permissive for now
        }
    },
    credentials: true,
}));
app.use(express.json({ limit: '50mb' }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

// ─── Multi-User Session Management ──────────────────────────
// Map<userId, { client, isReady, socketIds: Set }>
const userSessions = new Map();

function getUserSession(userId) {
    return userSessions.get(userId) || null;
}

function createWhatsAppClient(userId) {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
            ],
        },
    });

    const session = {
        client,
        isReady: false,
        socketIds: new Set(),
    };

    client.on('qr', (qr) => {
        console.log(`[User ${userId}] QR Code received`);
        session.isReady = false;
        // Emit only to this user's sockets
        for (const sid of session.socketIds) {
            io.to(sid).emit('qr', qr);
        }
    });

    client.on('ready', () => {
        console.log(`[User ${userId}] ✅ WhatsApp client ready`);
        session.isReady = true;
        for (const sid of session.socketIds) {
            io.to(sid).emit('client_status', 'ready');
        }
    });

    client.on('authenticated', () => {
        console.log(`[User ${userId}] Authenticated`);
    });

    client.on('auth_failure', (msg) => {
        console.error(`[User ${userId}] Auth failure:`, msg);
        for (const sid of session.socketIds) {
            io.to(sid).emit('client_status', 'auth_failure');
        }
    });

    client.on('disconnected', (reason) => {
        console.log(`[User ${userId}] Disconnected:`, reason);
        session.isReady = false;
        for (const sid of session.socketIds) {
            io.to(sid).emit('client_status', 'disconnected');
        }
        // Clean up
        destroyUserSession(userId);
    });

    client.on('message', async (message) => {
        try {
            const chat = await message.getChat();
            const contact = await message.getContact();
            const payload = {
                id: message.id._serialized,
                body: message.body,
                from: message.from,
                to: message.to,
                timestamp: message.timestamp,
                isForwarded: message.isForwarded,
                authorName: contact.name || contact.pushname || message.from,
                chatName: chat.name,
                fromMe: false,
            };
            for (const sid of session.socketIds) {
                io.to(sid).emit('new_message', payload);
            }
        } catch (err) {
            console.error(`[User ${userId}] Error processing message:`, err);
        }
    });

    client.on('message_create', async (message) => {
        if (message.fromMe) {
            try {
                const payload = {
                    id: message.id._serialized,
                    body: message.body,
                    from: message.from,
                    to: message.to,
                    timestamp: message.timestamp,
                    fromMe: true,
                };
                for (const sid of session.socketIds) {
                    io.to(sid).emit('new_message', payload);
                }
            } catch (err) { /* ignore */ }
        }
    });

    userSessions.set(userId, session);
    console.log(`[User ${userId}] Initializing WhatsApp client...`);
    client.initialize();

    return session;
}

async function destroyUserSession(userId) {
    const session = userSessions.get(userId);
    if (session) {
        try {
            await session.client.destroy();
        } catch (err) {
            console.error(`[User ${userId}] Error destroying client:`, err);
        }
        userSessions.delete(userId);
        console.log(`[User ${userId}] Session destroyed`);
    }
}

// ─── Socket.io with Auth ─────────────────────────────────────
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
        return next(new Error('Authentication required'));
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        socket.userEmail = decoded.email;
        next();
    } catch (err) {
        return next(new Error('Invalid token'));
    }
});

io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`[Socket] User ${userId} connected (${socket.id})`);

    // Get or create session for this user
    let session = getUserSession(userId);
    if (!session) {
        session = createWhatsAppClient(userId);
    }

    // Register this socket for this user's events
    session.socketIds.add(socket.id);

    // Send current status
    socket.emit('client_status', session.isReady ? 'ready' : 'initializing');

    socket.on('disconnect', () => {
        console.log(`[Socket] User ${userId} disconnected (${socket.id})`);
        if (session) {
            session.socketIds.delete(socket.id);
            // If no more sockets for this user, destroy after a grace period
            // (user might just be refreshing the page)
            setTimeout(() => {
                const currentSession = getUserSession(userId);
                if (currentSession && currentSession.socketIds.size === 0) {
                    console.log(`[User ${userId}] No active connections, destroying session...`);
                    destroyUserSession(userId);
                }
            }, 60000); // 60 second grace period
        }
    });

    // Allow user to manually request logout/disconnect their WhatsApp
    socket.on('logout_whatsapp', async () => {
        try {
            const session = getUserSession(userId);
            if (session && session.client) {
                await session.client.logout();
            }
            await destroyUserSession(userId);
            socket.emit('client_status', 'disconnected');
        } catch (err) {
            console.error(`[User ${userId}] Error logging out WhatsApp:`, err);
        }
    });
});

// ─── REST Routes ─────────────────────────────────────────────

// Auth routes (no middleware)
app.use('/api/auth', authRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', sessions: userSessions.size });
});

// Protected routes below — require auth
app.use('/api', authMiddleware);

// Get chats for the authenticated user
app.get('/api/chats', async (req, res) => {
    const session = getUserSession(req.user.id);
    if (!session || !session.isReady) {
        return res.status(503).json({ error: 'WhatsApp client not ready' });
    }
    try {
        const chats = await session.client.getChats();
        const simplifiedChats = chats
            .filter((c) => !c.id._serialized.includes('@g.us'))
            .map((c) => ({
                id: c.id._serialized,
                name: c.name,
                unreadCount: c.unreadCount,
                timestamp: c.timestamp,
                lastMessage: c.lastMessage ? c.lastMessage.body : null,
            }));
        res.json(simplifiedChats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get messages for a chat
app.get('/api/chats/:chatId/messages', async (req, res) => {
    const session = getUserSession(req.user.id);
    if (!session || !session.isReady) {
        return res.status(503).json({ error: 'WhatsApp client not ready' });
    }
    try {
        const chat = await session.client.getChatById(req.params.chatId);
        const messages = await chat.fetchMessages({ limit: 50 });
        const formattedMessages = messages.map((m) => ({
            id: m.id._serialized,
            body: m.body,
            from: m.from,
            to: m.to,
            timestamp: m.timestamp,
            fromMe: m.fromMe,
        }));
        res.json(formattedMessages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send a message
app.post('/api/send', async (req, res) => {
    const session = getUserSession(req.user.id);
    if (!session || !session.isReady) {
        return res.status(503).json({ error: 'WhatsApp client not ready' });
    }
    const { to, message } = req.body;
    if (!to || !message) {
        return res.status(400).json({ error: "Missing 'to' or 'message' parameters" });
    }
    try {
        const response = await session.client.sendMessage(to, message);
        res.json({ success: true, messageId: response.id._serialized });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Start Server ────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Backend running on port ${PORT}`);
    });
});
