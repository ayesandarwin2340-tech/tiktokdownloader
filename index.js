require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const NodeCache = require('node-cache');

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const API_BASE_URL = process.env.API_BASE_URL;
const ADMIN_IDS = process.env.ADMIN_IDS.split(',').map(Number);
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Rate limiting setup
const rateLimitCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const RATE_LIMIT_FILE = path.join(__dirname, 'rate_limits.json');

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// ==================== UTILITY FUNCTIONS ====================

// Detect Burmese language
function detectLanguage(data) {
    const text = data.text || data.from?.first_name || '';
    const burmeseRegex = /[\u1000-\u109F]/;
    return burmeseRegex.test(text);
}

// Rate limiting
async function checkRateLimit(userId) {
    try {
        let limits = {};
        
        try {
            const data = await fs.readFile(RATE_LIMIT_FILE, 'utf8');
            limits = JSON.parse(data || '{}');
        } catch (error) {
            limits = {};
        }

        const now = Math.floor(Date.now() / 1000);

        // Clean old entries
        Object.keys(limits).forEach(uid => {
            if (now - limits[uid].last_request > 3600) {
                delete limits[uid];
            }
        });

        if (!limits[userId]) {
            limits[userId] = {
                count: 1,
                last_request: now,
                first_request: now
            };
        } else {
            limits[userId].count++;
            limits[userId].last_request = now;
        }

        await fs.writeFile(RATE_LIMIT_FILE, JSON.stringify(limits, null, 2));

        // Allow 15 requests per minute, 60 per hour
        const minuteLimit = (now - limits[userId].first_request <= 60) ? 15 : 60;
        
        return limits[userId].count <= minuteLimit;
    } catch (error) {
        console.error('Rate limit error:', error);
        return true; // Allow on error
    }
}

async function getRateLimitInfo(userId) {
    try {
        const data = await fs.readFile(RATE_LIMIT_FILE, 'utf8');
        const limits = JSON.parse(data || '{}');
        
        if (!limits[userId]) {
            return { used: 0, remaining: 60 };
        }
        
        const used = limits[userId].count;
        const remaining = Math.max(0, 60 - used);
        
        return { used, remaining };
    } catch (error) {
        return { used: 0, remaining: 60 };
    }
}

// TikTok API calls
async function callTikTokAPI(endpoint, params = {}) {
    try {
        const url = `${API_BASE_URL}?endpoint=${endpoint}&${new URLSearchParams(params)}`;
        const response = await axios.get(url, {
            timeout: 30000,
            headers: { 'User-Agent': 'TikTokBot/1.0' }
        });
        
        return response.data;
    } catch (error) {
        console.error('TikTok API error:', error);
        return { success: false, error: error.message };
    }
}

// Extract TikTok URL
function extractTikTokUrl(text) {
    const patterns = [
        /https?:\/\/(vm|vt)\.tiktok\.com\/[A-Za-z0-9]+\/?/,
        /https?:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9._]+\/video\/[0-9]+\/?/,
        /https?:\/\/(www\.)?tiktok\.com\/t\/[A-Za-z0-9]+\/?/
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return match[0];
        }
    }
    
    return null;
}

// ==================== MESSAGE HANDLERS ====================

async function handleStartCommand(ctx) {
    const isBurmese = detectLanguage(ctx.message);
    const userId = ctx.from.id;
    
    const welcome = isBurmese ? 
        `👋 <b>TikTok Downloader Bot</b> မှ ကြိုဆိုပါတယ်!\n\n` +
        `🎬 <b>စပါယ်ရှယ် ထူးခြားချက်:</b>\n` +
        `• ✅ Watermark မပါသော ဗီဒီယိုများ\n` +
        `• 🎵 အရည်အသွေးမြင့် MP3 အသံများ\n` +
        `• 🖼️ ဓာတ်ပုံ Slideshow များ\n` +
        `• ⚡ မြန်ဆန်သော Download နှုန်း\n\n` +
        `📝 <b>အသုံးပြုနည်း:</b>\n` +
        `TikTok link ကို ပေးပို့ရုံပါပဲ!\n\n` +
        `🔧 <b>Commands:</b>\n` +
        `/start - Bot အကြောင်း\n` +
        `/help - အကူအညီရယူရန်\n` +
        `/stats - အသုံးပြုမှုစာရင်း` :
        
        `👋 <b>Welcome to TikTok Downloader Bot!</b>\n\n` +
        `🎬 <b>Special Features:</b>\n` +
        `• ✅ Videos without watermark\n` +
        `• 🎵 High quality MP3 audio\n` +
        `• 🖼️ Photo slideshows\n` +
        `• ⚡ Fast download speed\n\n` +
        `📝 <b>How to use:</b>\n` +
        `Just send me a TikTok URL!\n\n` +
        `🔧 <b>Commands:</b>\n` +
        `/start - About bot\n` +
        `/help - Get help\n` +
        `/stats - Usage statistics`;
    
    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.url('📖 How to Use', 'https://telegra.ph/TikTok-Downloader-Guide-01-15'),
            Markup.button.url('🌟 Rate Bot', 'https://t.me/tbotratingbot?start=ttdl-bot')
        ]
    ]);
    
    await ctx.reply(welcome, { 
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup
    });
}

async function handleHelpCommand(ctx) {
    const isBurmese = detectLanguage(ctx.message);
    
    const help = isBurmese ? 
        `📖 <b>TikTok Downloader အသုံးပြုနည်း</b>\n\n` +
        `1. 📱 <b>TikTok App</b> မှ video link ကို copy လုပ်ပါ\n` +
        `2. 🤖 <b>Bot</b> ထံသို့ paste လုပ်ပါ\n` +
        `3. 📥 Download format ကို ရွေးချယ်ပါ\n\n` +
        `🔗 <b>Supported Link Formats:</b>\n` +
        `• https://vm.tiktok.com/XXXXXX/\n` +
        `• https://vt.tiktok.com/XXXXXX/\n` +
        `• https://tiktok.com/@user/video/123456789\n\n` +
        `⚠️ <b>မှတ်ချက်များ:</b>\n` +
        `• တစ်နာရီလျှင် 60 ကြိမ်သာ အသုံးပြုနိုင်ပါသည်\n` +
        `• Private videos များကို ဒေါင်းလုပ်ဆွဲ၍မရပါ\n` +
        `• တစ်ခါတစ်ရံ ဆာဗာပေါ်မူတည်၍ ကြာနိုင်ပါသည်` :
        
        `📖 <b>TikTok Downloader Help Guide</b>\n\n` +
        `1. 📱 <b>Copy video link</b> from TikTok app\n` +
        `2. 🤖 <b>Paste the link</b> to this bot\n` +
        `3. 📥 <b>Choose download format</b>\n\n` +
        `🔗 <b>Supported Link Formats:</b>\n` +
        `• https://vm.tiktok.com/XXXXXX/\n` +
        `• https://vt.tiktok.com/XXXXXX/\n` +
        `• https://tiktok.com/@user/video/123456789\n\n` +
        `⚠️ <b>Notes:</b>\n` +
        `• Rate limit: 60 requests per hour\n` +
        `• Private videos cannot be downloaded\n` +
        `• May take longer depending on server load`;
    
    await ctx.reply(help, { parse_mode: 'HTML' });
}

async function handleStatsCommand(ctx) {
    const isBurmese = detectLanguage(ctx.message);
    const userId = ctx.from.id;
    
    const rateInfo = await getRateLimitInfo(userId);
    
    const stats = isBurmese ? 
        `📊 <b>အသုံးပြုမှုစာရင်း</b>\n\n` +
        `👤 <b>User ID:</b> <code>${userId}</code>\n` +
        `📥 <b>အသုံးပြုပြီး:</b> ${rateInfo.used} ကြိမ်\n` +
        `📤 <b>ကျန်ရှိသည်:</b> ${rateInfo.remaining} ကြိမ်\n` +
        `⏰ <b>ပြန်လည်သတ်မှတ်ချိန်:</b> 1 နာရီ\n\n` +
        `⚡ <b>Bot Status:</b> Active\n` +
        `🔧 <b>Version:</b> 2.0 (Node.js)` :
        
        `📊 <b>Usage Statistics</b>\n\n` +
        `👤 <b>User ID:</b> <code>${userId}</code>\n` +
        `📥 <b>Requests Used:</b> ${rateInfo.used}\n` +
        `📤 <b>Requests Left:</b> ${rateInfo.remaining}\n` +
        `⏰ <b>Reset Time:</b> 1 hour\n\n` +
        `⚡ <b>Bot Status:</b> Active\n` +
        `🔧 <b>Version:</b> 2.0 (Node.js)`;
    
    await ctx.reply(stats, { parse_mode: 'HTML' });
}

async function handleTikTokUrl(ctx) {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const messageId = ctx.message.message_id;
    const isBurmese = detectLanguage(ctx.message);
    
    const tiktokUrl = extractTikTokUrl(text);
    
    if (!tiktokUrl) {
        const errorMsg = isBurmese ? 
            `❌ <b>မှားယွင်းသော TikTok Link</b>\n\n` +
            `ကျေးဇူးပြု၍ မှန်ကန်သော TikTok link တစ်ခုပေးပါ။\n\n` +
            `✅ <b>ဥပမာများ:</b>\n` +
            `• https://vm.tiktok.com/ABC123/\n` +
            `• https://tiktok.com/@user/video/123456789` :
            
            `❌ <b>Invalid TikTok URL</b>\n\n` +
            `Please provide a valid TikTok URL.\n\n` +
            `✅ <b>Examples:</b>\n` +
            `• https://vm.tiktok.com/ABC123/\n` +
            `• https://tiktok.com/@user/video/123456789`;
        
        await ctx.reply(errorMsg, { 
            parse_mode: 'HTML',
            reply_to_message_id: messageId
        });
        return;
    }
    
    // Send processing message
    const processingMsg = isBurmese ? 
        `⏳ <b>TikTok ဒေတာရယူနေသည်...</b>\n\n` +
        `ကျေးဇူးပြု၍ စောင့်ပါ...` :
        `⏳ <b>Fetching TikTok data...</b>\n\n` +
        `Please wait...`;
    
    const processingMessage = await ctx.reply(processingMsg, { 
        parse_mode: 'HTML',
        reply_to_message_id: messageId
    });
    
    try {
        await ctx.sendChatAction('upload_photo');
        const apiResponse = await callTikTokAPI('info', { url: tiktokUrl });
        
        if (!apiResponse.success) {
            const errorMsg = isBurmese ? 
                `❌ <b>ဒေတာရယူခြင်းမအောင်မြင်ပါ</b>\n\n` +
                `ကျေးဇူးပြု၍:\n` +
                `• Link ကိုပြန်စစ်ပါ\n` +
                `• နောက်မှထပ်ကြိုးစားပါ\n` +
                `• တစ်ခြား link တစ်ခုပိုးပါ\n\n` +
                `🔧 <b>Error:</b> ${apiResponse.error || 'Unknown error'}` :
                
                `❌ <b>Failed to fetch data</b>\n\n` +
                `Please:\n` +
                `• Check the link\n` +
                `• Try again later\n` +
                `• Try another link\n\n` +
                `🔧 <b>Error:</b> ${apiResponse.error || 'Unknown error'}`;
            
            await bot.telegram.editMessageText(
                chatId, 
                processingMessage.message_id, 
                null, 
                errorMsg, 
                { parse_mode: 'HTML' }
            );
            return;
        }
        
        const videoData = apiResponse.data;
        await sendMediaOptions(ctx, videoData, tiktokUrl, isBurmese, processingMessage.message_id);
    } catch (error) {
        console.error('Error processing TikTok URL:', error);
        await ctx.reply(`❌ Error: ${error.message}`);
    }
}

async function sendMediaOptions(ctx, videoData, originalUrl, isBurmese, messageId) {
    const keyboard = [];
    
    if (videoData.has_audio) {
        keyboard.push([
            Markup.button.callback(
                isBurmese ? '🎵 MP3 (အသံ)' : '🎵 MP3 (Audio)',
                `tt_dl:audio:${Buffer.from(originalUrl).toString('base64')}`
            )
        ]);
    }
    
    if (videoData.has_video) {
        keyboard.push([
            Markup.button.callback(
                isBurmese ? '🎬 MP4 (ဗီဒီယို)' : '🎬 MP4 (Video)',
                `tt_dl:video:${Buffer.from(originalUrl).toString('base64')}`
            )
        ]);
    }
    
    if (videoData.has_photos) {
        keyboard.push([
            Markup.button.callback(
                isBurmese ? '🖼️ ဓာတ်ပုံများ' : '🖼️ Photos',
                `tt_dl:photos:${Buffer.from(originalUrl).toString('base64')}`
            )
        ]);
    }
    
    if (keyboard.length === 0) {
        const errorMsg = isBurmese ? 
            `❌ <b>မည်သည့် media မှမတွေ့ရှိပါ</b>\n\n` +
            `ဒီ TikTok video မှာ download ဆွဲနိုင်တဲ့ media မရှိပါဘူး။` :
            `❌ <b>No media found</b>\n\n` +
            `This TikTok video doesn't have any downloadable media.`;
        
        await bot.telegram.editMessageText(
            ctx.chat.id,
            messageId,
            null,
            errorMsg,
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    const contentType = videoData.has_video ? (isBurmese ? 'ဗီဒီယို' : 'Video') : 
                       (videoData.has_photos ? (isBurmese ? 'ဓာတ်ပုံများ' : 'Photos') : 
                       (isBurmese ? 'အကြောင်းအရာ' : 'Content'));

    const caption = isBurmese ? 
        `📌 <b>TikTok ${contentType}</b>\n` +
        `🎤 <b>ဖန်တီးသူ:</b> ${escapeHtml(videoData.author?.nickname || 'Unknown')}\n` +
        `❤️ <b>Like:</b> ${formatNumber(videoData.digg_count)}\n` +
        `▶️ <b>View:</b> ${formatNumber(videoData.play_count)}\n` +
        `💬 <b>Comment:</b> ${formatNumber(videoData.comment_count)}\n\n` +
        `ဒေါင်းလုပ်ဆွဲရန်ဖော်မက်ရွေးပါ:` :
        
        `📌 <b>TikTok ${contentType}</b>\n` +
        `🎤 <b>Creator:</b> ${escapeHtml(videoData.author?.nickname || 'Unknown')}\n` +
        `❤️ <b>Likes:</b> ${formatNumber(videoData.digg_count)}\n` +
        `▶️ <b>Views:</b> ${formatNumber(videoData.play_count)}\n` +
        `💬 <b>Comments:</b> ${formatNumber(videoData.comment_count)}\n\n` +
        `Choose download format:`;
    
    try {
        await bot.telegram.editMessageMedia(
            ctx.chat.id,
            messageId,
            null,
            {
                type: 'photo',
                media: videoData.cover,
                caption: caption,
                parse_mode: 'HTML'
            },
            {
                reply_markup: Markup.inlineKeyboard(keyboard).reply_markup
            }
        );
    } catch (error) {
        console.error('Error editing message:', error);
    }
}

async function handleDownloadRequest(ctx, url, type, isBurmese) {
    const chatId = ctx.chat.id;
    const messageId = ctx.callbackQuery.message.message_id;
    
    // Update message to downloading
    const downloadingMsg = isBurmese ? 
        `⏳ <b>ဒေါင်းလုပ်ဆွဲနေသည်...</b>\n\n` +
        `ကျေးဇူးပြု၍ စောင့်ပါ\n` +
        `ဗီဒီယိုအရွယ်အစားပေါ်မူတည်၍ ကြာနိုင်ပါသည်` : 
        `⏳ <b>Downloading...</b>\n\n` +
        `Please wait...\n` +
        `This may take a while depending on video size`;
    
    try {
        await ctx.editMessageText(downloadingMsg, { parse_mode: 'HTML' });
        
        // Send appropriate chat action
        const actions = {
            'video': 'upload_video',
            'audio': 'upload_audio',
            'photos': 'upload_photo'
        };
        
        await ctx.sendChatAction(actions[type] || 'upload_photo');
        
        // Fetch download URL from API
        const apiResponse = await callTikTokAPI('download', { url, type });
        
        if (!apiResponse.success) {
            const errorMsg = isBurmese ? 
                `❌ <b>ဒေါင်းလုပ်ဆွဲရန် မအောင်မြင်ပါ</b>\n\n` +
                `ကျေးဇူးပြု၍ နောက်မှထပ်ကြိုးစားပါ\n\n` +
                `🔧 <b>Error:</b> ${apiResponse.error || 'Unknown error'}` : 
                `❌ <b>Download failed</b>\n\n` +
                `Please try again later\n\n` +
                `🔧 <b>Error:</b> ${apiResponse.error || 'Unknown error'}`;
            
            await ctx.editMessageText(errorMsg, { parse_mode: 'HTML' });
            return;
        }
        
        const downloadData = apiResponse;
        
        // Send success message first
        const successMsg = isBurmese ? 
            `✅ <b>ဒေါင်းလုပ်ဆွဲပြီးပါပြီ!</b>\n\n` +
            `📦 Media ကို ပို့နေသည်...` : 
            `✅ <b>Download completed!</b>\n\n` +
            `📦 Sending media...`;
        
        await ctx.editMessageText(successMsg, { parse_mode: 'HTML' });
        
        const caption = isBurmese ? 
            `✅ <b>Download ဆွဲပြီးပါပြီ!</b>\n\n` +
            `🎬 ${BOT_USERNAME} မှ download ဆွဲထားသည်\n` +
            `🔧 Powered by @ItachiXCoder` :
            
            `✅ <b>Download Completed!</b>\n\n` +
            `🎬 Downloaded via ${BOT_USERNAME}\n` +
            `🔧 Powered by @ItachiXCoder`;
        
        try {
            switch(type) {
                case 'video':
                    if (downloadData.url) {
                        await bot.telegram.sendVideo(chatId, downloadData.url, {
                            caption: caption,
                            parse_mode: 'HTML',
                            supports_streaming: true
                        });
                    }
                    break;
                    
                case 'audio':
                    if (downloadData.url) {
                        await bot.telegram.sendAudio(chatId, downloadData.url, {
                            caption: caption,
                            parse_mode: 'HTML'
                        });
                    }
                    break;
                    
                case 'photos':
                    if (downloadData.photos && downloadData.photos.length > 0) {
                        const media = downloadData.photos.map((photo, index) => ({
                            type: 'photo',
                            media: photo.url,
                            caption: index === 0 ? caption : undefined,
                            parse_mode: index === 0 ? 'HTML' : undefined
                        }));
                        
                        await bot.telegram.sendMediaGroup(chatId, media);
                    }
                    break;
            }
            
            // Delete the processing message
            await bot.telegram.deleteMessage(chatId, messageId);
        } catch (mediaError) {
            console.error('Error sending media:', mediaError);
            const errorMsg = isBurmese ? 
                `❌ <b>Media ပို့ခြင်းမအောင်မြင်ပါ</b>\n\n` +
                `ကျေးဇူးပြု၍ နောက်မှထပ်ကြိုးစားပါ` : 
                `❌ <b>Failed to send media</b>\n\n` +
                `Please try again later`;
            
            await ctx.editMessageText(errorMsg, { parse_mode: 'HTML' });
        }
    } catch (error) {
        console.error('Download error:', error);
        await ctx.answerCbQuery(`Error: ${error.message}`, true);
    }
}

// ==================== BOT SETUP ====================

// Command handlers
bot.command('start', async (ctx) => {
    const allowed = await checkRateLimit(ctx.from.id);
    if (!allowed) {
        const isBurmese = detectLanguage(ctx.message);
        const errorMsg = isBurmese ? 
            '❌ အသုံးပြုမှုများလွန်းပါတယ်\n' +
            'ကျေးဇူးပြု၍ 1 နာရီကြာပြီးမှ ထပ်ကြိုးစားပါ' :
            '❌ Rate limit exceeded\n' +
            'Please try again after 1 hour';
        await ctx.reply(errorMsg);
        return;
    }
    await handleStartCommand(ctx);
});

bot.command('help', async (ctx) => {
    await handleHelpCommand(ctx);
});

bot.command('stats', async (ctx) => {
    await handleStatsCommand(ctx);
});

// Handle TikTok URLs
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    if (text.startsWith('/')) {
        return; // Let command handlers handle commands
    }
    
    const allowed = await checkRateLimit(ctx.from.id);
    if (!allowed) {
        const isBurmese = detectLanguage(ctx.message);
        const errorMsg = isBurmese ? 
            `❌ <b>အသုံးပြုမှုများလွန်းပါတယ်</b>\n\n` +
            `ကျေးဇူးပြု၍ 1 နာရီကြာပြီးမှ ထပ်ကြိုးစားပါ\n\n` +
            `📊 တစ်နာရီလျှင် 60 ကြိမ်သာ အသုံးပြုနိုင်ပါသည်` :
            `❌ <b>Rate limit exceeded</b>\n\n` +
            `Please try again after 1 hour\n\n` +
            `📊 Rate limit: 60 requests per hour`;
        await ctx.reply(errorMsg, { parse_mode: 'HTML' });
        return;
    }
    
    if (/tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/.test(text)) {
        await handleTikTokUrl(ctx);
    } else {
        const isBurmese = detectLanguage(ctx.message);
        const response = isBurmese ? 
            `🤖 <b>TikTok Downloader Bot</b>\n\n` +
            `ကျေးဇူးပြု၍ TikTok link တစ်ခုပေးပါ\n\n` +
            `📝 <b>အသုံးပြုနည်း:</b>\n` +
            `1. TikTok app မှ link ကို copy လုပ်ပါ\n` +
            `2. ဒီ chat ထဲ paste လုပ်ပါ\n` +
            `3. Download format ရွေးပါ\n\n` +
            `🔧 <b>Commands:</b>\n` +
            `/start - Bot အကြောင်း\n` +
            `/help - အကူအညီရယူရန်\n` +
            `/stats - အသုံးပြုမှုစာရင်း` :
            
            `🤖 <b>TikTok Downloader Bot</b>\n\n` +
            `Please provide a TikTok URL\n\n` +
            `📝 <b>How to use:</b>\n` +
            `1. Copy link from TikTok app\n` +
            `2. Paste it here\n` +
            `3. Choose download format\n\n` +
            `🔧 <b>Commands:</b>\n` +
            `/start - About bot\n` +
            `/help - Get help\n` +
            `/stats - Usage statistics`;
        
        await ctx.reply(response, { 
            parse_mode: 'HTML',
            reply_to_message_id: ctx.message.message_id
        });
    }
});

// Handle callback queries
bot.on('callback_query', async (ctx) => {
    const userId = ctx.from.id;
    const data = ctx.callbackQuery.data;
    
    const allowed = await checkRateLimit(userId);
    if (!allowed) {
        const isBurmese = detectLanguage(ctx.callbackQuery);
        const errorMsg = isBurmese ? 
            '❌ အသုံးပြုမှုများလွန်းပါတယ်\n' +
            'ကျေးဇူးပြု၍ 1 နာရီကြာပြီးမှ ထပ်ကြိုးစားပါ' :
            '❌ Rate limit exceeded\n' +
            'Please try again after 1 hour';
        await ctx.answerCbQuery(errorMsg, true);
        return;
    }
    
    const isBurmese = detectLanguage(ctx.callbackQuery);
    await ctx.answerCbQuery();
    
    if (data.startsWith('tt_dl:')) {
        const parts = data.split(':');
        const type = parts[1];
        const url = Buffer.from(parts[2], 'base64').toString();
        
        if (url && type) {
            await handleDownloadRequest(ctx, url, type, isBurmese);
        }
    }
});

// ==================== HELPER FUNCTIONS ====================

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ==================== SERVER SETUP ====================

// Webhook setup (for production)
if (WEBHOOK_URL) {
    const app = express();
    
    // Middleware
    app.use(express.json());
    
    // Webhook endpoint
    app.post(`/bot${BOT_TOKEN}`, (req, res) => {
        bot.handleUpdate(req.body);
        res.sendStatus(200);
    });
    
    // Health check
    app.get('/', (req, res) => {
        res.json({
            status: 'online',
            bot: BOT_USERNAME,
            version: '2.0.0'
        });
    });
    
    // Start server
    app.listen(PORT, async () => {
        console.log(`🤖 Bot running on port ${PORT}`);
        console.log(`🌐 Webhook URL: ${WEBHOOK_URL}/bot${BOT_TOKEN}`);
        
        try {
            // Set webhook
            await bot.telegram.setWebhook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
            console.log('✅ Webhook set successfully');
        } catch (error) {
            console.error('❌ Failed to set webhook:', error);
        }
    });
} else {
    // Polling mode (for development)
    console.log('🚀 Starting bot in polling mode...');
    bot.launch();
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

console.log('✅ TikTok Downloader Bot (Node.js) is starting...');
