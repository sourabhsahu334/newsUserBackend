// Simple test file to verify Google Generative AI is working
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

async function testAI() {
    try {
        console.log('Testing Google Generative AI...\n');

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                responseMimeType: "application/json"
            }
        });

        const prompt = `
Return a simple JSON object with the following structure:
{
  "message": "Hello from Gemini!",
  "status": "working",
  "timestamp": "<current date and time>"
}
`;

        console.log('Sending prompt to AI...');
        const result = await model.generateContent([{ text: prompt }]);

        const aiText = result.response.text();
        console.log('\n--- Raw AI Response ---');
        console.log(aiText);

        const parsed = JSON.parse(aiText);
        console.log('\n--- Parsed JSON ---');
        console.log(parsed);

        console.log('\n--- Token Usage ---');
        console.log('Prompt tokens:', result.response.usageMetadata.promptTokenCount);
        console.log('Response tokens:', result.response.usageMetadata.candidatesTokenCount);
        console.log('Total tokens:', result.response.usageMetadata.totalTokenCount);

        console.log('\n✅ AI test passed successfully!');

    } catch (error) {
        console.error('\n❌ AI test failed:', error.message);
        console.error(error);
    }
}

testAI();
