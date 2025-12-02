import { Request, Response } from "express";
import PdfParse from "pdf-parse";
import {uploadChunksToPinecone} from "../services/createEmbeddings.service";
import prisma from "../utils/prisma";

const pdfToEmbed = async (req: Request, res: Response) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "No file uploaded" });
    }

   const {userId}=req as Request & {userId?:string};

   if(!userId){
    return res.status(401).json({error:"Unauthorized"});
   }
   

   const user= await prisma.user.findUnique({
    where:{id:userId}
   });

   if(!user){
    return res.status(404).json({error:"User not found"});
   }
   

    const pdfBuffer: Buffer = req.file.buffer;

    const data = await PdfParse(pdfBuffer); // It's a function now, not a class!

    await uploadChunksToPinecone(data.text,"doc_123",userId);

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