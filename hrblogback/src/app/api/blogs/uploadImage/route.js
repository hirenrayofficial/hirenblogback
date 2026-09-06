import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image");

    if (!file) {
      return NextResponse.json(
        { success: 0, error: "No image file provided." },
        { status: 400 }
      );
    }

    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: 0, error: "ImgBB API key is missing." },
        { status: 500 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString("base64");

    const imgbbPayload = new URLSearchParams();
    imgbbPayload.append("image", base64Image);

    const imgbbResponse = await fetch(
      `https://api.imgbb.com/1/upload?key=${apiKey}`,
      {
        method: "POST",
        body: imgbbPayload,
      }
    );

    const imgbbData = await imgbbResponse.json();

    if (!imgbbResponse.ok || !imgbbData.success) {
      return NextResponse.json(
        { success: 0, error: "Failed to upload to ImgBB." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: 1,
      file: {
        url: imgbbData.data.url,
      },
    });
  } catch (error) {
    console.error("Upload Error:", error);
    return NextResponse.json(
      { success: 0, error: "Internal Server Error." },
      { status: 500 }
    );
  }
}