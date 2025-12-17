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
 * Section boundary definition for detection in full text
 */
interface SectionBoundary {
  pattern: RegExp;
  section: string;
}

/**
 * Detected section with its text content
 */
interface DetectedSection {
  section: string;
  text: string;
}

/**
 * Detect and split text into sections based on section headers
 * Section detection happens BEFORE chunking
 */
function detectAndSplitSections(text: string): DetectedSection[] {
  const sectionBoundaries: SectionBoundary[] = [
    {
      pattern: /^(skills?|technical\s+skills?|core\s+competencies?)/i,
      section: "skills",
    },
    {
      pattern:
        /^(experience|work\s+history|employment\s+history|professional\s+experience)/i,
      section: "experience",
    },
    {
      pattern:
        /^(education|academic\s+background|degrees?|university|college)/i,
      section: "education",
    },
    {
      pattern: /^(projects?|portfolio|key\s+projects?|notable\s+projects?)/i,
      section: "projects",
    },
    {
      pattern:
        /^(summary|objective|profile|about\s+me|professional\s+summary)/i,
      section: "summary",
    },
    {
      pattern: /^(contact|contact\s+information|reach\s+out)/i,
      section: "contact",
    },
    { pattern: /^(languages?|language\s+proficiency)/i, section: "languages" },
    {
      pattern:
        /^(awards?|honors?|recognitions?|certifications?|certificates?)/i,
      section: "awards",
    },
  ];

  const lines = text.split(/\n+/);
  const sections: DetectedSection[] = [];
  let currentSection = "other";
  let currentText: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if this line is a section header
    let isSectionHeader = false;
    for (const { pattern, section } of sectionBoundaries) {
      if (pattern.test(line) && line.length < 100) {
        // Save previous section if it has content
        if (currentText.length > 0) {
          sections.push({
            section: currentSection,
            text: currentText.join("\n").trim(),
          });
        }
        // Start new section
        currentSection = section;
        currentText = [];
        isSectionHeader = true;
        break;
      }
    }

    if (!isSectionHeader) {
      currentText.push(lines[i]);
    }
  }

  // Add the last section
  if (currentText.length > 0) {
    sections.push({
      section: currentSection,
      text: currentText.join("\n").trim(),
    });
  }

  // If no sections were detected, treat entire text as "other"
  if (sections.length === 0) {
    sections.push({
      section: "other",
      text: text.trim(),
    });
  }

  return sections.filter((s) => s.text.length > 0);
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

    // Step 1: Detect sections BEFORE chunking
    console.log("Detecting sections in document...");
    const detectedSections = detectAndSplitSections(text);
    console.log(
      `✓ Detected ${detectedSections.length} sections: ${detectedSections
        .map((s) => s.section)
        .join(", ")}`
    );

    console.log("detectedSections", detectedSections);
    
    // Step 2: Chunk each section separately
    console.log(
      "Using LlamaIndex SentenceSplitter for section-wise chunking..."
    );
    const chunksWithEmbeddings: ChunkEmbedding[] = [];
    let globalChunkIndex = 0;

    for (const detectedSection of detectedSections) {
      if (!detectedSection.text.trim()) {
        continue;
      }

      // Chunk this section
      const sectionChunks = splitTextWithLlamaIndex(detectedSection.text);

      // Filter out empty or very small chunks
      const filteredSectionChunks = sectionChunks.filter(
        (c) => c.trim().length > 50
      );

      console.log(
        `  Section "${detectedSection.section}": ${filteredSectionChunks.length} chunks`
      );

      // Embed chunks for this section
      for (let i = 0; i < filteredSectionChunks.length; i++) {
        try {
          const embedding = await embeddings.embedQuery(
            filteredSectionChunks[i]
          );

          chunksWithEmbeddings.push({
            chunk: filteredSectionChunks[i],
            embedding,
            index: globalChunkIndex,
            section: detectedSection.section,
          });

          globalChunkIndex++;

          // Log progress every 5 chunks
          if (chunksWithEmbeddings.length % 5 === 0) {
            console.log(`  Embedded ${chunksWithEmbeddings.length} chunks...`);
          }
        } catch (err: any) {
          console.error(
            `Failed to embed chunk ${globalChunkIndex}:`,
            err.message
          );
          // Continue with next chunk instead of failing completely
        }
      }
    }

    console.log(`✓ Created ${chunksWithEmbeddings.length} total chunks`);
    if (chunksWithEmbeddings.length > 0) {
      console.log(
        `Chunk sizes: min=${Math.min(
          ...chunksWithEmbeddings.map((c) => c.chunk.length)
        )}, max=${Math.max(...chunksWithEmbeddings.map((c) => c.chunk.length))}`
      );
    }
    console.log(
      `✓ Successfully embedded ${chunksWithEmbeddings.length} chunks`
    );
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
            `  Uploaded ${item.index + 1}/${
              chunksWithEmbeddings.length
            } chunks to Pinecone and DB...`
          );
        }
      } catch (err: any) {
        console.error(`Failed to process chunk ${item.index}:`, err.message);
        throw new Error(
          `Failed to process chunk ${item.index}: ${err.message}`
        );
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
): Promise<{ text: string; section: string | null; resumeId: string } | null> {
  try {
    const chunk = await prisma.resumeChunk.findFirst({
      where: { pineconeId: pineconeId },
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