import { Request, Response } from "express";
import PdfParse from "pdf-parse";
import {uploadChunksToPinecone} from "../services/createEmbeddings.service";

const pdfToEmbed = async (req: Request, res: Response) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const pdfBuffer: Buffer = req.file.buffer;

    const data = await PdfParse(pdfBuffer); // It's a function now, not a class!

    await uploadChunksToPinecone(data.text,"doc_123");

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