import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const { data: blogs, error } = await supabase
      .from("blogs")
      .select("id, slug, blog_title, blog_description, image_url, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase error fetching blogs:", error);
      return NextResponse.json(
        { error: "Failed to fetch blogs." },
        { status: 500 }
      );
    }

    // Format array for frontend compatibility
    const formattedBlogs = blogs.map((blog) => ({
      id: blog.id,
      slug: blog.slug,
      blog_title: blog.blog_title,
      blog_description: blog.blog_description,
      imageUrl: blog.image_url,
      createAt: new Date(blog.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }));

    return NextResponse.json(formattedBlogs);
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}