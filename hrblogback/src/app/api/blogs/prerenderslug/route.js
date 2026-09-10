import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug'); // e.g., "/blog/my-first-post"

    if (!slug) {
        return new NextResponse('Slug parameter is missing', { status: 400 });
    }

    const { data: post, error } = await supabase
        .from('blogs')
        .select('blog_title, slug, blog_description, image_url, content, created_at, updated_at, author_name')
        .eq('slug', slug)
        .single();

    if (error || !post) {
        return new NextResponse('Post not found in database', { status: 404 });
    }

    // Ensure absolute URLs for images and canonical paths
    const domain = process.env.NEXT_PUBLIC_SITE_URL || 'https://hirenray.rest';
    const canonicalUrl = `${domain}/blog/${post.slug}`;
    const imageUrl = post.image_url?.startsWith('http') ? post.image_url : `${domain}${post.image_url || ''}`;

    // JSON-LD Structured Data (Schema.org) for SEO and AIO (AI Overviews / Perplexity / GPTBot)
    const structuredData = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": post.blog_title,
        "description": post.blog_description || "",
        "image": imageUrl ? [imageUrl] : [],
        "datePublished": post.created_at || new Date().toISOString(),
        "dateModified": post.updated_at || post.created_at || new Date().toISOString(),
        "author": {
            "@type": "Person",
            "name": post.author_name || "Hiren Ray"
        },
        "mainEntityOfPage": {
            "@type": "WebPage",
            "@id": canonicalUrl
        }
    };

    const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${post.blog_title}</title>
        <meta name="description" content="${post.blog_description || ''}" />
        <link rel="canonical" href="${canonicalUrl}" />

        <!-- Open Graph / Facebook / AI Bot Previews -->
        <meta property="og:type" content="article" />
        <meta property="og:title" content="${post.blog_title}" />
        <meta property="og:description" content="${post.blog_description || ''}" />
        <meta property="og:url" content="${canonicalUrl}" />
        ${imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : ''}

        <!-- Twitter Card -->
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${post.blog_title}" />
        <meta name="twitter:description" content="${post.blog_description || ''}" />
        ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}" />` : ''}

        <!-- JSON-LD Structured Data for Google SEO & AI Engines -->
        <script type="application/ld+json">
          ${JSON.stringify(structuredData)}
        </script>
      </head>
      <body>
        <div id="root">
          <article>
            <h1>${post.blog_title}</h1>
            ${imageUrl ? `<img src="${imageUrl}" alt="${post.blog_title}" />` : ''}
            <div class="post-content">
              ${post.content}
            </div>
          </article>
        </div>
      </body>
    </html>
  `;

    return new NextResponse(html, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
    });
}