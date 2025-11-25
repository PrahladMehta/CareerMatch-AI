import { Request, Response } from "express";
import PdfParse from "pdf-parse";

const pdfToEmbed = async (req: Request, res: Response) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const pdfBuffer: Buffer = req.file.buffer;

    // Convert Buffer → Uint8Array
    const pdfData = new Uint8Array(pdfBuffer);

    // Correct way to use pdf-parse v2+
    const data = await PdfParse(pdfData); // It's a function now, not a class!

    return res.json({
      text: data.text,
      numPages: data.numpages,
      metadata: data.metadata,
      version: data.version
    });

  } catch (error: any) {
    console.error("PDF parsing error:", error);
    return res.status(500).json({ 
      error: "Failed to process PDF", 
      details: error.message 
    });
  }
};

export { pdfToEmbed };