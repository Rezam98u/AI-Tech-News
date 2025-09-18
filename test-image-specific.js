// Test specific image handling for the iOS article
require('dotenv').config();

async function testImageHandling() {
    console.log('🔍 Testing Image Handling for iOS Article...\n');
    
    try {
        const { fetchAllArticles } = require('./dist/data-aggregator');
        
        console.log('📡 Fetching articles...');
        const articles = await fetchAllArticles();
        
        // Find the iOS article specifically
        const iosArticle = articles.find(article => 
            article.title.includes('iOS') && article.title.includes('screenshot')
        );
        
        if (!iosArticle) {
            console.log('❌ iOS screenshot article not found');
            return;
        }
        
        console.log('📱 Found iOS Article:');
        console.log(`Title: ${iosArticle.title}`);
        console.log(`Link: ${iosArticle.link}`);
        console.log(`Has Image: ${iosArticle.imageUrl ? '✅' : '❌'}`);
        
        if (iosArticle.imageUrl) {
            console.log(`Image URL: ${iosArticle.imageUrl}`);
            console.log(`Image URL Length: ${iosArticle.imageUrl.length}`);
            console.log(`Image URL Valid: ${iosArticle.imageUrl.startsWith('http') ? '✅' : '❌'}`);
            
            // Check if image is accessible
            const axios = require('axios');
            try {
                console.log('\n🌐 Testing image accessibility...');
                const response = await axios.head(iosArticle.imageUrl, { timeout: 10000 });
                console.log(`✅ Image accessible: ${response.status} ${response.statusText}`);
                console.log(`Content-Type: ${response.headers['content-type']}`);
                console.log(`Content-Length: ${response.headers['content-length']} bytes`);
            } catch (imgError) {
                console.log(`❌ Image not accessible: ${imgError.message}`);
                console.log(`Error code: ${imgError.code}`);
                console.log(`Status: ${imgError.response?.status}`);
            }
        }
        
        // Test the complete flow
        console.log('\n🧪 Testing complete image flow...');
        
        const { getPostReadyAnalysis } = require('./dist/ai-analysis/optimized');
        const analysis = await getPostReadyAnalysis(iosArticle);
        
        console.log('Analysis completed:', {
            hasTldr: !!analysis.tldr,
            bulletCount: analysis.bullets.length,
            hasDescription: !!analysis.description
        });
        
        // Simulate the post creation
        const hashtags = analysis.hashtags.length > 0 
            ? '\n\n' + analysis.hashtags.map(tag => `#${tag}`).join(' ')
            : '';
        
        const shortLink = iosArticle.link.length > 60 
            ? iosArticle.link.substring(0, 57) + '...' 
            : iosArticle.link;
        
        const timeAgo = 'just now';
        
        const bulletsSection = analysis.bullets && analysis.bullets.length > 0
            ? '\n\n🔸 ' + analysis.bullets.join('\n🔸 ')
            : '';
        
        const businessSection = analysis.business_implication && analysis.business_implication.trim()
            ? `\n\n💼 **Business Impact:** ${analysis.business_implication}`
            : '';
        
        const enhancedPost = `💡 ${analysis.tldr}${bulletsSection}${businessSection}

${analysis.description}${hashtags}

⏰ ${timeAgo}
🔗 ${shortLink}`;

        console.log('\n📱 Complete Post Preview:');
        console.log('='.repeat(50));
        console.log(enhancedPost);
        console.log('='.repeat(50));
        
        console.log('\n🎯 Image Info for Telegram:');
        console.log(`Image URL: ${iosArticle.imageUrl || 'None'}`);
        console.log(`Will try to send image: ${iosArticle.imageUrl ? 'Yes' : 'No'}`);
        
        if (iosArticle.imageUrl) {
            console.log('\n🔧 Telegram Image Requirements Check:');
            console.log(`- Starts with http: ${iosArticle.imageUrl.startsWith('http') ? '✅' : '❌'}`);
            console.log(`- Length < 200: ${iosArticle.imageUrl.length < 200 ? '✅' : '❌'} (${iosArticle.imageUrl.length})`);
            console.log(`- Contains spaces: ${iosArticle.imageUrl.includes(' ') ? '❌' : '✅'}`);
            console.log(`- Valid extension: ${/\.(jpg|jpeg|png|gif|webp)/i.test(iosArticle.imageUrl) ? '✅' : '❓'}`);
        }
        
    } catch (error) {
        console.log(`❌ Test failed: ${error.message}`);
        console.log('Stack:', error.stack);
    }
}

testImageHandling();
