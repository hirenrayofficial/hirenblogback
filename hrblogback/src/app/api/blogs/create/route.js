import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Helper function to convert blog title into a URL slug
function createSlug(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")      // Replace spaces and underscores with hyphens
    .replace(/[^\w\-]+/g, "")     // Remove non-alphanumeric characters
    .replace(/\-\-+/g, "-")       // Replace multiple consecutive hyphens with a single hyphen
    .replace(/^-+/, "")           // Trim hyphens from start
    .replace(/-+$/, "");          // Trim hyphens from end
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { blog_title, blog_description, imageUrl, content, imageBase64 } = body;

    // 1. Validation
    if (!blog_title || !content) {
      return NextResponse.json(
        { error: "Title and content are required." },
        { status: 400 }
      );
    }

    // 2. Generate slug from title
    const baseSlug = createSlug(blog_title);
    // Append random string to guarantee uniqueness (e.g. "my-first-post-x9k2p")
    const uniqueSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 7)}`;

    let finalImageUrl = imageUrl || null;

    // 3. Upload image to ImgBB if base64 data is supplied
    if (imageBase64) {
      const apiKey = process.env.IMGBB_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: "ImgBB API key is missing on the server." },
          { status: 500 }
        );
      }

      const formData = new URLSearchParams();
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      formData.append("image", cleanBase64);

      const imgbbRes = await fetch(
        `https://api.imgbb.com/1/upload?key=${apiKey}`,
        {
          method: "POST",
          body: formData,
        }
      );

      const imgbbData = await imgbbRes.json();

      if (!imgbbRes.ok || !imgbbData.success) {
        console.error("ImgBB Upload Failed:", imgbbData);
        return NextResponse.json(
          { error: "Failed to upload image to ImgBB." },
          { status: 500 }
        );
      }

      finalImageUrl = imgbbData.data.url;
    }

    // 4. Save blog post record to Supabase (including slug)
    const { data, error } = await supabase
      .from("blogs")
      .insert([
        {
          blog_title,
          slug: uniqueSlug, // <-- Saved here
          blog_description,
          image_url: finalImageUrl,
          content, // Stores raw Editor.js JSON blocks
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Supabase Database Error:", error);
      return NextResponse.json(
        { error: "Failed to save blog post to database." },
        { status: 500 }
      );
    }

    // 5. Return success response
    return NextResponse.json(
      {
        message: "Blog post published successfully!",
        blog: data,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("API Route Error:", err);
    return NextResponse.json(
      { error: "Internal Server Error." },
      { status: 500 }
    );
  }
}