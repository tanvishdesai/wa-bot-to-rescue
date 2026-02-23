const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Initialize the client with local authentication
// This saves the session so you don't have to scan the QR code every time
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // Run headful or headless depending on environment
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-extensions']
    }
});

// Event: Emit QR code
client.on('qr', (qr) => {
    // Generate and display QR code in terminal
    console.log('Scan this QR code with your WhatsApp app on your phone:');
    qrcode.generate(qr, { small: true });
});

// Event: Client is ready
client.on('ready', () => {
    console.log('✅ Client is ready! Your Node.js WhatsApp bot is now online.');
});

// Event: Incoming message handling
client.on('message', async message => {
    console.log(`[Message Received] From: ${message.from} | Text: ${message.body}`);
    const lowerBody = message.body.toLowerCase();

    // Ignore group messages or status broadcast messages
    if (message.from === 'status@broadcast' || message.from.includes('@g.us')) {
        return;
    }

    try {
        let replyText = "👋 Hi!\n1️⃣ Book appointment\n2️⃣ Help";

        if (lowerBody.includes("hi") || lowerBody.includes("hello")) {
            replyText = "👋 Hello! What would you like to do?\n1️⃣ Book appointment\n2️⃣ Help";
        } else if (lowerBody.includes("help")) {
            replyText = "ℹ️ I can help you book appointments via WhatsApp.";
        }

        // Send the reply
        await client.sendMessage(message.from, replyText);
        console.log(`[Reply Sent] ${replyText.replace(/\n/g, ' ')}`);
    } catch (err) {
        console.error('Error sending message:', err);
    }
});

// Start the client
console.log("Starting WhatsApp Client...");
client.initialize();
