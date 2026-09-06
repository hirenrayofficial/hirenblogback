import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request, { params }) {
  try {
    // Await params before destructuring properties
    const { slug } = await params;

    if (!slug || slug === "undefined") {
      return NextResponse.json(
        { error: "Invalid slug provided." },
        { status: 400 }
      );
    }

    const { data: blog, error } = await supabase
      .from("blogs")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error || !blog) {
      return NextResponse.json(
        { error: "Blog post not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: blog.id,
      slug: blog.slug,
      blog_title: blog.blog_title,
      blog_description: blog.blog_description,
      imageUrl: blog.image_url,
      content: blog.content,
      createAt: new Date(blog.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}