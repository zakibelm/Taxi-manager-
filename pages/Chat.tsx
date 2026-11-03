import React, { useState, useEffect, useRef } from 'react';

import { backend } from '../services/storage';

import { AIConversation, Service } from '../types';

import { Send, Bot, User, Sparkles, MoreVertical, Plus } from 'lucide-react';



interface ChatProps {

  services: Service[];

}



const Chat: React.FC<ChatProps> = ({ services }) => {

  const [messages, setMessages] = useState<AIConversation[]>([]);

  const [input, setInput] = useState('');

  const [isTyping, setIsTyping] = useState(false);

  const [error, setError] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);



  useEffect(() => {

    // Load history

    setMessages(backend.getConversations());

  }, []);



  useEffect(() => {

    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  }, [messages, isTyping]);



  const handleSend = async (e: React.FormEvent) => {

    e.preventDefault();

    if (!input.trim() || isTyping) return;

    setError('');



    const tempId = crypto.randomUUID();

    const userMsg: AIConversation = {

        id: tempId,

        driver_email: 'current',

        user_message: input,

        ai_response: '', // Pending

        created_at: new Date().toISOString()

    };



    setMessages(prev => [...prev, userMsg]);

    setInput('');

    setIsTyping(true);



    try {

        const totalRevenue = services.reduce((sum, s) => sum + s.amount, 0);

        const context = { totalRevenue, count: services.length };

        const response = await backend.sendChatMessage(userMsg.user_message, context);

        setMessages(prev => prev.map(m => m.id === tempId ? response : m));

    } catch (error) {

        setMessages(prev => prev.filter(m => m.id !== tempId));

        setInput(input);

        setError(error instanceof Error ? error.message : 'Assistant indisponible.');

    } finally {

        setIsTyping(false);

    }

  };



  return (

    <div className="flex flex-col h-[calc(100vh-100px)] md:h-[calc(100vh-60px)] animate-in fade-in duration-500 pb-20 md:pb-0">

        <div className="flex items-center justify-between mb-4 px-2">

            <div>

                <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">

                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>

                    Assistant Taxi Manager

                </h2>

                <p className="text-slate-400 text-xs font-medium">En ligne • Assistant Ops</p>

            </div>

            <button className="p-2 hover:bg-slate-100 rounded-full text-slate-400">

                <MoreVertical size={20} />

            </button>

        </div>



        <div className="flex-1 bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden flex flex-col relative">

            {error && <p role="alert" className="p-4 text-red-700">{error}</p>}

            {/* Messages Area */}

            <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-white">

                {messages.length === 0 && (

                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-6">

                        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">

                            <Bot size={32} className="text-red-500" />

                        </div>

                        <div className="text-center">

                            <h3 className="text-slate-900 font-bold mb-1">Bonjour ! Je suis l’assistant Taxi Manager.</h3>

                            <p className="text-sm text-slate-400">Comment puis-je vous aider avec votre quart ?</p>

                        </div>

                        <div className="flex flex-col gap-2 w-full max-w-xs">

                            <button onClick={() => setInput("Montre-moi mes revenus")} className="py-3 px-4 bg-slate-50 rounded-xl text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors text-left">

                                💰 Montre-moi mes revenus

                            </button>

                            <button onClick={() => setInput("Prévisions trafic pour demain?")} className="py-3 px-4 bg-slate-50 rounded-xl text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors text-left">

                                🚦 Prévisions trafic

                            </button>

                        </div>

                    </div>

                )}



                {messages.map((msg) => (

                    <React.Fragment key={msg.id}>

                        {/* User Bubble - Red */}

                        <div className="flex justify-end">

                            <div className="flex items-end gap-2 max-w-[85%] flex-row-reverse">

                                <div className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden flex-shrink-0 border-2 border-white shadow-sm">

                                    <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white text-xs">Moi</div>

                                </div>

                                <div>

                                    <div className="bg-red-600 text-white p-4 rounded-2xl rounded-tr-none shadow-md shadow-red-100">

                                        <p className="text-sm font-medium">{msg.user_message}</p>

                                    </div>

                                    <p className="text-[10px] text-slate-300 text-right mt-1 mr-1">{new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>

                                </div>

                            </div>

                        </div>



                        {/* AI Bubble - White/Gray */}

                        {msg.ai_response && (

                            <div className="flex justify-start">

                                <div className="flex items-end gap-2 max-w-[85%]">

                                    <div className="w-8 h-8 rounded-full bg-white overflow-hidden flex-shrink-0 border border-slate-100 p-1.5 shadow-sm">

                                        <Bot className="w-full h-full text-red-600" />

                                    </div>

                                    <div>

                                        <div className="bg-slate-50 border border-slate-100 text-slate-800 p-4 rounded-2xl rounded-tl-none">

                                            <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">{msg.ai_response}</p>

                                        </div>

                                        <p className="text-[10px] text-slate-300 mt-1 ml-1">Taxi Manager</p>

                                    </div>

                                </div>

                            </div>

                        )}

                    </React.Fragment>

                ))}



                {isTyping && (

                    <div className="flex justify-start">

                         <div className="flex items-end gap-2">

                            <div className="w-8 h-8 rounded-full bg-white overflow-hidden flex-shrink-0 border border-slate-100 p-1.5 shadow-sm">

                                <Bot className="w-full h-full text-red-600" />

                            </div>

                            <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl rounded-tl-none">

                                <div className="flex gap-1.5">

                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></span>

                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></span>

                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span>

                                </div>

                            </div>

                        </div>

                    </div>

                )}

                <div ref={messagesEndRef} />

            </div>



            {/* Input Area */}

            <div className="p-4 bg-white border-t border-slate-50">
                <p className="text-xs text-slate-500 mb-2 px-2">Vos messages sont traités par un fournisseur d’IA externe. N’y inscrivez ni courriel, ni téléphone, ni numéro de carte.</p>

                <form onSubmit={handleSend} className="flex gap-2 items-center bg-slate-50 p-1.5 rounded-full border border-slate-100 focus-within:ring-2 focus-within:ring-red-100 transition-all">

                    <button type="button" className="p-2 text-slate-400 hover:text-red-500 rounded-full transition-colors">

                        <Plus size={20} />

                    </button>

                    <input 

                        type="text"

                        maxLength={2000}

                        value={input}

                        onChange={(e) => setInput(e.target.value)}

                        placeholder="Message à l’assistant..."

                        className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-medium text-slate-900 placeholder-slate-400"

                    />

                    <button 

                        type="submit"

                        disabled={!input.trim() || isTyping}

                        className="p-2.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-red-200"

                    >

                        <Send size={18} />

                    </button>

                </form>

            </div>

        </div>

    </div>

  );

};



export default Chat;