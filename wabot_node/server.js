const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let isClientReady = false;

// Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Socket.io Connection
io.on('connection', (socket) => {
    console.log('Frontend connected:', socket.id);
    
    // Send initial state upon connection
    socket.emit('client_status', isClientReady ? 'ready' : 'initializing');

    socket.on('disconnect', () => {
        console.log('Frontend disconnected:', socket.id);
    });
});

// WhatsApp Events
client.on('qr', (qr) => {
    console.log('QR Code Received, routing to frontend...');
    isClientReady = false;
    io.emit('qr', qr);
});

client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
    isClientReady = true;
    io.emit('client_status', 'ready');
});

client.on('message', async message => {
    console.log(`[Message Received] From: ${message.from}`);
    try {
        const chat = await message.getChat();
        const contact = await message.getContact();
        
        // Broadcast the new message to frontend UI
        io.emit('new_message', {
            id: message.id._serialized,
            body: message.body,
            from: message.from,
            to: message.to,
            timestamp: message.timestamp,
            isForwarded: message.isForwarded,
            authorName: contact.name || contact.pushname || message.from,
            chatName: chat.name,
            fromMe: false,
        });
    } catch (err) {
        console.error("Error processing incoming message:", err);
    }
});

// Broadcast messages sent by the host (us) so the UI updates natively
client.on('message_create', async message => {
    if (message.fromMe) {
        try {
            io.emit('new_message', {
                id: message.id._serialized,
                body: message.body,
                from: message.from,
                to: message.to,
                timestamp: message.timestamp,
                fromMe: true,
            });
        } catch (err) {}
    }
});

// REST API Endpoints

// 1. Get List of Recent Chats
app.get('/api/chats', async (req, res) => {
    if (!isClientReady) return res.status(503).json({ error: "Client not ready" });
    try {
        const chats = await client.getChats();
        const simplifiedChats = chats
            .filter(c => !c.id._serialized.includes('@g.us')) // Ignore groups for now to keep it clean
            .map(c => ({
                id: c.id._serialized,
                name: c.name,
                unreadCount: c.unreadCount,
                timestamp: c.timestamp,
                lastMessage: c.lastMessage ? c.lastMessage.body : null
            }));
        res.json(simplifiedChats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Get Messages for a specific Chat
app.get('/api/chats/:chatId/messages', async (req, res) => {
    if (!isClientReady) return res.status(503).json({ error: "Client not ready" });
    try {
        const chatId = req.params.chatId;
        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 50 }); // Fetch last 50 messages
        
        const formattedMessages = messages.map(m => ({
            id: m.id._serialized,
            body: m.body,
            from: m.from,
            to: m.to,
            timestamp: m.timestamp,
            fromMe: m.fromMe
        }));
        
        res.json(formattedMessages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Send a Message manually
app.post('/api/send', async (req, res) => {
    if (!isClientReady) return res.status(503).json({ error: "Client not ready" });
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: "Missing 'to' or 'message' parameters" });

    try {
        const response = await client.sendMessage(to, message);
        res.json({ success: true, messageId: response.id._serialized });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start the server
const PORT = 4000;
server.listen(PORT, () => {
    console.log(`Backend Express Server running on http://localhost:${PORT}`);
    console.log('Initializing WhatsApp Client...');
    client.initialize();
});
