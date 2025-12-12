// src/services/createEmbeddings.service.ts

import { OpenAIEmbeddings } from "@langchain/openai";
import { SentenceSplitter } from "llamaindex";
import dotenv from "dotenv";
import upsertVector from "./insertVector.service";
import { v4 as uuid } from "uuid";
import prisma from "../utils/prisma";
dotenv.config();

// Types
interface ChunkEmbedding {
  chunk: string;
  embedding: number[];
  index: number;
  section: string;
}

interface Metadata {
  chunkIndex: number;
  chunkContent: string;
  fileName: string;
  createdAt: string;
  userId: string;
  resumeId: string;
  section: string;
}

// Initialize embeddings
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-3-small",
});

/**
 * Detect resume section from text
 * Returns the section name (skills, experience, education, etc.)
 */
function detectSection(text: string): string {
  const lowerText = text.toLowerCase();

  // Define section patterns
  const sectionPatterns = [
    { pattern: /skill|proficiency|technical|competency/i, section: "skills" },
    { pattern: /experience|employment|work history|professional/i, section: "experience" },
    { pattern: /education|degree|university|college|certification/i, section: "education" },
    { pattern: /project|portfolio|achievement|accomplishment/i, section: "projects" },
    { pattern: /summary|objective|profile|about/i, section: "summary" },
    { pattern: /contact|phone|email|address|linkedin/i, section: "contact" },
    { pattern: /language|fluent|native|proficient/i, section: "languages" },
    { pattern: /award|honor|recognition|certificate/i, section: "awards" },
  ];

  for (const { pattern, section } of sectionPatterns) {
    if (pattern.test(lowerText)) {
      return section;
    }
  }

  return "other"; // default section
}

/**
 * Split text using LlamaIndex SentenceSplitter
 * Maintains semantic coherence by splitting at sentence boundaries
 */
function splitTextWithLlamaIndex(
  text: string,
  chunkSize = 300,
  chunkOverlap = 20
): string[] {
  const splitter = new SentenceSplitter({
    chunkSize,
    chunkOverlap,
  });

  return splitter.splitText(text);
}

export async function createChunkedEmbeddings(
  text: string
): Promise<ChunkEmbedding[]> {
  try {
    if (!text?.trim()) {
      throw new Error("Text cannot be empty");
    }

    // Use LlamaIndex SentenceSplitter
    console.log("Using LlamaIndex SentenceSplitter...");
    const chunks = splitTextWithLlamaIndex(text);

    // Filter out empty or very small chunks
    const filteredChunks = chunks.filter((c) => c.trim().length > 50);

    console.log(`✓ Created ${filteredChunks.length} chunks`);
    console.log(
      `Chunk sizes: min=${Math.min(...filteredChunks.map((c) => c.length))}, max=${Math.max(...filteredChunks.map((c) => c.length))}`
    );

    const chunksWithEmbeddings: ChunkEmbedding[] = [];

    // Embed chunks with batch processing to avoid rate limits
    for (let i = 0; i < filteredChunks.length; i++) {
      try {
        const embedding = await embeddings.embedQuery(filteredChunks[i]);
        const section = detectSection(filteredChunks[i]);

        chunksWithEmbeddings.push({
          chunk: filteredChunks[i],
          embedding,
          index: i,
          section,
        });

        // Log progress every 5 chunks
        if ((i + 1) % 5 === 0) {
          console.log(`  Embedded ${i + 1}/${filteredChunks.length} chunks...`);
        }
      } catch (err: any) {
        console.error(`Failed to embed chunk ${i}:`, err.message);
        // Continue with next chunk instead of failing completely
      }
    }

    console.log(`✓ Successfully embedded ${chunksWithEmbeddings.length} chunks`);
    return chunksWithEmbeddings;
  } catch (error: any) {
    console.error("Embedding error:", error);
    throw new Error(`Failed to create embeddings: ${error.message}`);
  }
}

export async function uploadChunksToPinecone(
  text: string,
  fileName: string,
  userId: string
): Promise<void> {
  try {
    console.log(`Starting chunk creation and upload for document: ${fileName}`);

    // Create resume record
    const resume = await prisma.resume.create({
      data: {
        userId: userId,
        rawText: text,
        name: fileName,
      },
    });

    const chunksWithEmbeddings = await createChunkedEmbeddings(text);

    if (chunksWithEmbeddings.length === 0) {
      throw new Error("No chunks were created from the document");
    }

    console.log(
      `Uploading ${chunksWithEmbeddings.length} chunks to Pinecone...`
    );

    // Upload to Pinecone and store in database
    for (const item of chunksWithEmbeddings) {
      const pineconeId = uuid();

      const metadata: Metadata = {
        chunkIndex: item.index,
        chunkContent: item.chunk,
        fileName: fileName,
        createdAt: new Date().toISOString(),
        userId: userId,
        resumeId: resume.id,
        section: item.section,
      };

      try {
        // Upload to Pinecone
        await upsertVector(pineconeId, item.embedding, metadata);

        // Store chunk in database
        await prisma.resumeChunk.create({
          data: {
            resumeId: resume.id,
            userId: userId,
            chunkIndex: item.index,
            section: item.section,
            text: item.chunk,
            pineconeId: pineconeId,
            source: "resume",
          },
        });

        // Log every 10 uploads
        if ((item.index + 1) % 10 === 0) {
          console.log(
            `  Uploaded ${item.index + 1}/${chunksWithEmbeddings.length} chunks to Pinecone and DB...`
          );
        }
      } catch (err: any) {
        console.error(`Failed to process chunk ${item.index}:`, err.message);
        throw new Error(`Failed to process chunk ${item.index}: ${err.message}`);
      }
    }

    console.log(
      `✓ All ${chunksWithEmbeddings.length} chunks uploaded to Pinecone and stored in DB successfully!`
    );
  } catch (error: any) {
    console.error("Error uploading chunks to Pinecone:", error);
    throw new Error(`Failed to upload chunks: ${error.message}`);
  }
}

/**
 * Retrieve a chunk with its context from database
 * Useful for displaying citations in responses
 */
export async function getChunkById(
  pineconeId: string
): Promise<{ text: string; section: string|null; resumeId: string } | null> {
  try {
    const chunk = await prisma.resumeChunk.findFirst({
      where: { pineconeId:pineconeId },
      select: {
        text: true,
        section: true,
        resumeId: true,
      },
    });
    return chunk;
  } catch (error: any) {
    console.error("Error retrieving chunk:", error);
    return null;
  }
}