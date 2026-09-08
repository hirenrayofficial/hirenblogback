import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// CLIENTS
// ---------------------------------------------------------------------------
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MAX_RETRIES = 2;

// ---------------------------------------------------------------------------
// SCHEMA
// Editor.js block shape, tightened so the model can't emit malformed content
// or HTML that would break the front-end renderer.
// ---------------------------------------------------------------------------
const blogSchema = {
    type: Type.OBJECT,
    properties: {
        blog_title: {
            type: Type.STRING,
            description: 'A compelling, SEO-friendly title, 50-65 characters, no clickbait, no trailing punctuation.'
        },
        slug: {
            type: Type.STRING,
            description: 'URL-safe slug derived from the title: lowercase, words separated by hyphens, no special characters, max 60 characters.'
        },
        blog_description: {
            type: Type.STRING,
            description: 'A meta-description for SEO, 140-160 characters, summarizing the value of the article in plain language.'
        },
        tags: {
            type: Type.ARRAY,
            description: '3 to 6 lowercase topical tags relevant to the article (single words or short phrases, no hashtags).',
            items: { type: Type.STRING }
        },
        svg_illustration: {
            type: Type.STRING,
            description:
                'A single valid, self-contained SVG string, viewBox="0 0 800 400", minimalist abstract banner using at most 3 colors. ' +
                'Must start with "<svg" and end with "</svg>" with no surrounding markdown, no external references, no <script> tags.'
        },
        blocks: {
            type: Type.ARRAY,
            description:
                'An ordered array of 10 to 16 Editor.js content blocks forming the article body. ' +
                'Every heading is its own "header" block; every paragraph is its own "paragraph" block. ' +
                'Never merge a heading and its following paragraph into one block. Never include HTML markup inside any text field.',
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
                            text: {
                                type: Type.STRING,
                                description: 'Plain text only. No HTML tags of any kind (no <p>, <b>, <table>, <br>, etc).'
                            },
                            level: {
                                type: Type.INTEGER,
                                description: 'Heading level 2-4. Only present when type is "header". Use level 2 for main sections, 3 for sub-sections.'
                            },
                            style: {
                                type: Type.STRING,
                                enum: ['ordered', 'unordered'],
                                description: 'Only present when type is "list".'
                            },
                            items: {
                                type: Type.ARRAY,
                                items: { type: Type.STRING },
                                description: 'Plain text list items. Only present when type is "list". No HTML.'
                            },
                            caption: {
                                type: Type.STRING,
                                description: 'Only present when type is "quote", as attribution.'
                            }
                        }
                    }
                },
                required: ['type', 'data']
            }
        }
    },
    required: ['blog_title', 'slug', 'blog_description', 'tags', 'svg_illustration', 'blocks']
};

// ---------------------------------------------------------------------------
// PROMPT
// A structured system + task prompt gets meaningfully better, more
// consistent output than a single paragraph of instructions.
// ---------------------------------------------------------------------------
const SYSTEM_INSTRUCTION = `You are a senior software engineer and technical writer who has shipped
production systems for 10+ years. You write blog posts the way experienced
engineers actually talk to each other: concrete, opinionated, willing to
name trade-offs, and allergic to filler and hype.

Hard rules you must always follow:
1. Output must validate against the provided JSON schema exactly. No extra fields, no missing required fields.
2. Never wrap the JSON in markdown code fences or add any commentary outside the JSON.
3. Never use HTML tags anywhere inside text fields.
4. Every distinct heading and every distinct paragraph is its own separate Editor.js block. Do not combine them.
5. The SVG must be small, valid, self-closing, and safe to inline as a data URI (no external URLs, no scripts, no event handlers).
6. Write like a human practitioner, not a marketing page: use "I" or "we" when sharing experience, avoid generic AI phrasing
   like "In today's fast-paced digital world" or "In conclusion", and avoid restating the title verbatim in the intro.`;

function buildPrompt(topicPrompt) {
    const topic =
        topicPrompt?.trim() ||
        'Write an in-depth, human-style technical blog post about modern full-stack web development trends.';

    return `Topic / brief:
${topic}

Structure requirements:
- Open with 1-2 short paragraphs that hook the reader with a concrete problem or observation, not a dictionary-style intro.
- Organize the body under 2-3 H2 sections (level 2 headers). Add an H3 sub-section under at least one of them if it helps clarity.
- Include exactly 1 bullet or numbered list where it genuinely helps (a checklist, trade-offs, or steps).
- Include 1 short quote block only if it adds a memorable takeaway; otherwise omit the quote block entirely.
- Close with a brief, practical takeaway paragraph. No generic "In conclusion" language.
- Total body length: roughly 700-1000 words across all paragraph blocks combined.

SEO requirements:
- blog_title: specific and search-friendly, not generic.
- slug: derived from the title, lowercase-hyphenated.
- blog_description: written for a search-results snippet, not a repeat of the title.
- tags: real topical keywords a reader would search for.

Illustration requirement:
- svg_illustration: an abstract, minimalist 800x400 banner that fits a dark tech-blog theme (e.g. slate/blue tones), under 15 lines of SVG markup.`;
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Strip stray markdown fences some models add despite instructions, then parse. */
function parseModelJson(rawText) {
    const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
}

/** Basic structural sanity check beyond what the schema alone guarantees. */
function validateGeneratedBlog(blog) {
    const errors = [];
    if (!blog.blog_title || blog.blog_title.length < 10) errors.push('blog_title missing or too short');
    if (!Array.isArray(blog.blocks) || blog.blocks.length < 5) errors.push('blocks missing or too few');
    if (!blog.slug) errors.push('slug missing');
    const hasHeader = Array.isArray(blog.blocks) && blog.blocks.some((b) => b.type === 'header');
    if (!hasHeader) errors.push('no header block present');
    return errors;
}

/** Ensures the SVG is well-formed enough to inline; falls back to a safe default otherwise. */
function sanitizeSvg(rawSvg) {
    const fallback = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><rect width="800" height="400" fill="#0f172a"/><text x="400" y="200" fill="#38bdf8" font-family="sans-serif" font-size="24" text-anchor="middle">Blog Illustration</text></svg>`;

    if (!rawSvg || typeof rawSvg !== 'string') return fallback;

    const trimmed = rawSvg.trim();
    const looksValid =
        trimmed.startsWith('<svg') &&
        trimmed.endsWith('</svg>') &&
        !/<script/i.test(trimmed) &&
        !/on\w+\s*=/i.test(trimmed); // strip anything with inline event handlers (onclick=, onload=, etc.)

    return looksValid ? trimmed : fallback;
}

function toSlug(title, fallbackSeed) {
    const base = (title || fallbackSeed || 'post')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60)
        .replace(/^-+|-+$/g, '');
    return `${base || 'post'}-${Date.now()}`;
}

/**
 * Calls Gemini with the schema-constrained prompt, retrying on transient
 * failures or JSON that fails validation.
 */
async function generateBlogContent(topicPrompt) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        try {
            const response = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: buildPrompt(topicPrompt),
                config: {
                    systemInstruction: SYSTEM_INSTRUCTION,
                    responseMimeType: 'application/json',
                    responseSchema: blogSchema,
                    temperature: 0.7,
                    topP: 0.9,
                    maxOutputTokens: 8192
                }
            });

            const parsed = parseModelJson(response.text);
            const errors = validateGeneratedBlog(parsed);

            if (errors.length > 0) {
                throw new Error(`Generated content failed validation: ${errors.join(', ')}`);
            }

            return parsed;
        } catch (err) {
            lastError = err;
            console.warn(`Generation attempt ${attempt} failed: ${err.message}`);
        }
    }

    throw new Error(`AI generation failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`);
}

/** Builds the final Editor.js content object, banner image first. */
function assembleEditorJsContent(generated, imageUrl) {
    const bannerBlock = {
        type: 'image',
        data: {
            url: imageUrl,
            caption: generated.blog_title,
            stretched: true,
            withBorder: false,
            withBackground: false
        }
    };

    return {
        time: Date.now(),
        blocks: [bannerBlock, ...generated.blocks],
        version: '2.30.0'
    };
}

/** Core pipeline shared by GET and POST: generate -> sanitize -> persist. */
async function generateAndStoreBlog(topicPrompt = null) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('Server misconfiguration: GEMINI_API_KEY is not set.');
    }

    const generated = await generateBlogContent(topicPrompt);

    const safeSvg = sanitizeSvg(generated.svg_illustration);
    const imageUrl = `data:image/svg+xml;base64,${Buffer.from(safeSvg).toString('base64')}`;

    const uniqueSlug = toSlug(generated.slug || generated.blog_title, topicPrompt);
    const content = assembleEditorJsContent(generated, imageUrl);

    const { data: blogRecord, error: dbError } = await supabase
        .from('blogs')
        .insert([
            {
                blog_title: generated.blog_title,
                slug: uniqueSlug,
                blog_description: generated.blog_description,
                tags: generated.tags,
                image_url: imageUrl,
                content
            }
        ])
        .select();

    if (dbError) {
        throw new Error(`Supabase insert failed: ${dbError.message}`);
    }

    return blogRecord;
}

// ---------------------------------------------------------------------------
// ROUTE HANDLERS
// ---------------------------------------------------------------------------
export async function GET() {
    try {
        const blogRecord = await generateAndStoreBlog();
        return NextResponse.json({ success: true, data: blogRecord });
    } catch (err) {
        console.error('GET Handler Error:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        const body = await req.json().catch(() => ({}));
        const blogRecord = await generateAndStoreBlog(body?.fprompt);
        return NextResponse.json({ success: true, data: blogRecord });
    } catch (err) {
        console.error('POST Handler Error:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}