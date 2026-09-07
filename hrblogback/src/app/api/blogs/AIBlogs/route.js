import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const blogSchema = {
    type: Type.OBJECT,
    properties: {
        blog_title: { type: Type.STRING },
        slug: { type: Type.STRING },
        blog_description: { type: Type.STRING },
        svg_illustration: {
            type: Type.STRING,
            description: "A simple 10-line minimalist SVG banner (<svg viewBox='0 0 800 400' ...>...</svg>). Keep extremely simple."
        },
        blocks: {
            type: Type.ARRAY,
            description: "8 to 12 detailed Editor.js blocks covering an intro, 3 sub-sections, key takeaways, and conclusion.",
            items: {
                type: Type.OBJECT,
                properties: {
                    type: {
                        type: Type.STRING,
                        enum: ['header', 'paragraph', 'list', 'quote']
                    },
                    data: {
                        type: Type.OBJECT,
                        properties: {
                            text: { type: Type.STRING },
                            level: { type: Type.INTEGER },
                            style: { type: Type.STRING, enum: ['ordered', 'unordered'] },
                            items: { type: Type.ARRAY, items: { type: Type.STRING } },
                            caption: { type: Type.STRING }
                        }
                    }
                },
                required: ['type', 'data']
            }
        }
    },
    required: ['blog_title', 'slug', 'blog_description', 'svg_illustration', 'blocks']
};

export async function GET(req) {
    try {
        const prompt = `Write an in-depth, human-style technical blog post about modern full-stack web development trends.

Writing Guidelines:
- Tone: Conversational, senior engineer perspective, sharing practical developer experiences and real-world trade-offs.
- Content Depth: Write detailed, multi-paragraph explanations across 3 clear sub-headings (H2). Include 1 bullet list of key takeaways and 1 quote block.
- SVG Banner: Create a very basic 800x400 minimalist abstract SVG string (under 15 lines of code) to save output budget.`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: blogSchema,
                temperature: 0.7,
                maxOutputTokens: 8192
            }
        });

        let generatedText;
        try {
            generatedText = JSON.parse(response.text);
        } catch (parseErr) {
            throw new Error(`JSON Parsing Truncated: ${parseErr.message}`);
        }

        // Convert SVG string to Data URI
        const rawSvg = generatedText.svg_illustration;
        const base64Svg = Buffer.from(rawSvg).toString('base64');
        const finalImageUrl = `data:image/svg+xml;base64,${base64Svg}`;

        const uniqueSlug = `${generatedText.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;

        // Combine Image block with body content blocks
        const updatedBlocks = [
            {
                type: 'image',
                data: {
                    url: finalImageUrl,
                    caption: generatedText.blog_title,
                    stretched: true,
                    withBorder: false,
                    withBackground: false
                }
            },
            ...generatedText.blocks
        ];

        const content = {
            time: Date.now(),
            blocks: updatedBlocks,
            version: '2.30.0'
        };

        // Store in Supabase
        const { data: blogRecord, error: dbError } = await supabase
            .from('blogs')
            .insert([
                {
                    blog_title: generatedText.blog_title,
                    slug: uniqueSlug,
                    blog_description: generatedText.blog_description,
                    image_url: finalImageUrl,
                    content: content,
                }
            ])
            .select();

        if (dbError) throw dbError;

        return NextResponse.json({ success: true, data: blogRecord });
    } catch (err) {
        console.error("Cron Handler Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}