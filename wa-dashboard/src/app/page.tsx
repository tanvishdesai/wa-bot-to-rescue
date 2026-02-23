"use client";

import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { Send, User, MessageSquare, Clock, Loader2, Search } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';

const API_URL = 'https://my-awesome-wa-bot.loca.lt';

interface Chat {
    id: string;
    name: string;
    unreadCount: number;
    timestamp: number;
    lastMessage: string | null;
}

interface Message {
    id: string;
    body: string;
    from: string;
    to: string;
    timestamp: number;
    fromMe: boolean;
}

export default function WhatsAppDashboard() {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [clientStatus, setClientStatus] = useState<'initializing' | 'qr' | 'ready'>('initializing');
    const [qrCodeData, setQrCodeData] = useState<string>('');
    
    const [chats, setChats] = useState<Chat[]>([]);
    const [activeChat, setActiveChat] = useState<Chat | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    
    const [inputMessage, setInputMessage] = useState('');
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Initial Setup & Socket Connection
    useEffect(() => {
        const newSocket = io(API_URL);
        setSocket(newSocket);

        newSocket.on('client_status', (status: string) => {
            setClientStatus(status as any);
            if (status === 'ready') fetchChats();
        });

        newSocket.on('qr', (qr: string) => {
            setQrCodeData(qr);
            setClientStatus('qr');
        });

        newSocket.on('new_message', (msg: Message) => {
            // Update chats list
            setChats(prev => {
                const existing = prev.find(c => c.id === msg.from || c.id === msg.to);
                if (existing) {
                    return prev.map(c => 
                        (c.id === msg.from || c.id === msg.to) 
                            ? { ...c, lastMessage: msg.body, timestamp: msg.timestamp } 
                            : c
                    ).sort((a, b) => b.timestamp - a.timestamp);
                } else {
                    // Need a full refresh if it's a completely new chat we don't know about
                    fetchChats();
                    return prev;
                }
            });

            // Append to active chat if it matches
            setActiveChat(prevActive => {
                if (prevActive && (prevActive.id === msg.from || prevActive.id === msg.to)) {
                    setMessages(prev => {
                        // avoid duplicate messages if socket reconnects
                        if (prev.find(m => m.id === msg.id)) return prev;
                        return [...prev, msg];
                    });
                }
                return prevActive;
            });
        });

        return () => { newSocket.close(); }
    }, []);

    // Scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Fetch Chats when Ready
    const fetchChats = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/chats`);
            setChats(res.data.sort((a: Chat, b: Chat) => b.timestamp - a.timestamp));
        } catch (err) {
            console.error("Error fetching chats:", err);
        }
    };

    // Load Messages for a Chat
    const handleChatSelect = async (chat: Chat) => {
        setActiveChat(chat);
        setMessages([]); // clear current
        try {
            const res = await axios.get(`${API_URL}/api/chats/${chat.id}/messages`);
            setMessages(res.data);
        } catch (err) {
            console.error("Error fetching messages:", err);
        }
    };

    // Send Message
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputMessage.trim() || !activeChat || sending) return;
        
        const tempMsg = inputMessage;
        setInputMessage('');
        setSending(true);

        try {
             // Optimistic UI update
             const optimisticMsg: Message = {
                id: `temp-${Date.now()}`,
                body: tempMsg,
                from: 'me',
                to: activeChat.id,
                timestamp: Math.floor(Date.now() / 1000),
                fromMe: true
            };
            setMessages(prev => [...prev, optimisticMsg]);

            await axios.post(`${API_URL}/api/send`, {
                to: activeChat.id,
                message: tempMsg
            });
            
        } catch (err) {
            console.error("Failed to send:", err);
            // Revert optimistic if failed
            setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')));
            setInputMessage(tempMsg);
        } finally {
            setSending(false);
        }
    };

    // Render Full Page Loading/QR
    if (clientStatus === 'initializing') {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
                <Loader2 className="w-12 h-12 text-green-600 animate-spin mb-4" />
                <h2 className="text-xl font-semibold text-gray-700">Connecting to WhatsApp Backend...</h2>
                <p className="text-gray-500 mt-2">Please wait while we initialize the browser session.</p>
            </div>
        );
    }

    if (clientStatus === 'qr') {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
                <div className="bg-white p-8 rounded-2xl shadow-xl flex flex-col items-center max-w-md w-full">
                    <div className="bg-green-100 p-4 rounded-full mb-6">
                        <MessageSquare className="w-8 h-8 text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">Link WhatsApp</h2>
                    <p className="text-gray-500 text-center mb-8">
                        Open WhatsApp on your phone &gt; Linked Devices &gt; Link a Device and scan the code below.
                    </p>
                    
                    <div className="bg-white p-4 border-2 border-green-100 rounded-xl">
                        {qrCodeData ? (
                            <QRCodeSVG value={qrCodeData} size={250} level="H" includeMargin />
                        ) : (
                            <div className="w-[250px] h-[250px] flex items-center justify-center bg-gray-50">
                                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-[#f0f2f5] overflow-hidden font-sans">
            {/* Left Sidebar - Chat List */}
            <div className="w-full md:w-[400px] border-r border-gray-200 bg-white flex flex-col shadow-sm z-10">
                {/* Header */}
                <div className="h-16 bg-[#00a884] text-white px-4 flex items-center justify-between shadow-md">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                            <User className="w-6 h-6" />
                        </div>
                        <h1 className="font-semibold text-lg tracking-wide">WhatsApp Dashboard</h1>
                    </div>
                </div>

                {/* Search */}
                <div className="p-3 bg-gray-50 border-b border-gray-100 flex-shrink-0">
                    <div className="relative">
                        <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                        <input 
                            type="text" 
                            placeholder="Search or start new chat" 
                            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all shadow-sm"
                        />
                    </div>
                </div>

                {/* Chat List */}
                <div className="flex-1 overflow-y-auto">
                    {chats.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                            <MessageSquare className="w-12 h-12 opacity-20" />
                            <p>No recent chats</p>
                        </div>
                    ) : (
                        chats.map((chat) => (
                            <div 
                                key={chat.id} 
                                onClick={() => handleChatSelect(chat)}
                                className={`flex items-start justify-between p-4 cursor-pointer hover:bg-gray-50 border-b border-gray-100 transition-colors ${activeChat?.id === chat.id ? 'bg-[#f0f2f5]' : ''}`}
                            >
                                <div className="flex space-x-4 items-center overflow-hidden">
                                     <div className="w-12 h-12 bg-gradient-to-br from-gray-200 to-gray-300 rounded-full flex-shrink-0 flex items-center justify-center border-2 border-white shadow-sm">
                                        <User className="w-6 h-6 text-gray-500" />
                                    </div>
                                    <div className="overflow-hidden">
                                        <h3 className="font-semibold text-gray-800 truncate">{chat.name}</h3>
                                        <p className="text-sm text-gray-500 truncate mt-1">{chat.lastMessage || 'Click to view'}</p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end flex-shrink-0 space-y-2">
                                    <span className="text-xs text-gray-400 font-medium">
                                        {format(new Date(chat.timestamp * 1000), 'h:mm a')}
                                    </span>
                                    {chat.unreadCount > 0 && (
                                        <span className="bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                                            {chat.unreadCount}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Right Main Area - Chat Viewer */}
            <div className="flex-1 flex flex-col bg-[#efeae2] relative hidden md:flex">
                {/* Chat Background Pattern */}
                <div className="absolute inset-0 opacity-[0.05] pointer-events-none bg-[url('https://whatsapp-clone-web.netlify.app/bg-chat-tile-dark_a4be512e7195b6b733d9110b408f075d.png')]" />

                 {!activeChat ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 z-10 relative">
                        <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 shadow-lg border border-gray-100">
                             <MessageSquare className="w-10 h-10 text-[#00a884]" />
                        </div>
                        <h2 className="text-3xl font-light text-gray-700 mb-4">WhatsApp Web Custom</h2>
                        <p className="text-gray-500 max-w-md">
                            Select a chat perfectly synchronized with your phone. Send and receive messages instantly.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Chat Header */}
                        <div className="h-16 bg-white px-6 flex justify-between items-center shadow-sm z-10">
                            <div className="flex items-center space-x-4">
                                <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                                    <User className="w-5 h-5 text-gray-500" />
                                </div>
                                <div>
                                    <h2 className="font-semibold text-gray-800">{activeChat.name}</h2>
                                    <p className="text-xs text-gray-500 flex items-center">
                                        <Clock className="w-3 h-3 mr-1" />
                                        Last active {format(new Date(activeChat.timestamp * 1000), 'h:mm a')}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4 z-10">
                            {messages.map((msg, i) => {
                                const isMe = msg.fromMe;
                                return (
                                    <div key={msg.id || i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                        <div 
                                            className={`max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm relative text-sm ${
                                                isMe 
                                                    ? 'bg-[#d9fdd3] text-gray-800 rounded-tr-none' 
                                                    : 'bg-white text-gray-800 rounded-tl-none border border-gray-100'
                                            }`}
                                        >
                                            <p className="whitespace-pre-wrap flex-1">{msg.body}</p>
                                            <div className="flex justify-end mt-1">
                                                <span className="text-[10px] text-gray-400 select-none">
                                                    {format(new Date(msg.timestamp * 1000), 'h:mm a')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Message Input Bar */}
                        <div className="bg-[#f0f2f5] p-4 flex items-center justify-center z-10 border-t border-gray-200">
                            <form onSubmit={handleSendMessage} className="max-w-4xl w-full flex items-center space-x-3 bg-white p-2 pl-4 rounded-xl shadow-sm border border-gray-200">
                                <input
                                    type="text"
                                    value={inputMessage}
                                    onChange={(e) => setInputMessage(e.target.value)}
                                    placeholder="Type a message"
                                    className="flex-1 bg-transparent border-none focus:outline-none text-gray-700 placeholder-gray-400 py-1"
                                    disabled={sending}
                                />
                                <button 
                                    type="submit" 
                                    disabled={!inputMessage.trim() || sending}
                                    className="w-10 h-10 bg-[#00a884] rounded-lg flex items-center justify-center text-white disabled:opacity-50 hover:bg-[#019373] transition-colors shadow-sm"
                                >
                                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                                </button>
                            </form>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
