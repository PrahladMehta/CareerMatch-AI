// src/utils/askQuestion.ts

import { queryRAG } from "./queryPincone.service.js";
import { ChatOpenAI } from "@langchain/openai";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import axios from "axios";
import prisma from "../utils/prisma.js";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { cache } from "./caching.js";

const TOP_K = 10;
const MIN_SCORE = 0.1;
const MODEL = "gpt-4o-mini";
const MAX_HISTORY_MESSAGES = 4;
const MAX_TOKENS_HISTORY = 1000;

const llm = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY!,
  model: MODEL,
  temperature: 0.1,
});

// import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

// const llm = new ChatGoogleGenerativeAI({
//   model: "gemini-2.0-flash",  // or "gemini-2.5-pro-exp", "gemini-1.5-pro"
//   temperature: 0.1,
//   googleApikey: process.env.GOOGLE_API_KEY!,  // optional if set in env
// });

const COMBINED_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a helpful assistant. Answer questions using resume context and web search results.
Consider conversation history for context and avoid repetition.
Rules:
1. Use resume as primary source, web search as supplementary
2. Clearly indicate source (e.g., "Based on your resume..." or "From web search...")
3. Reference previous answers if relevant
4. If BOTH sources lack info, say: "I don't have enough information"
5. Be concise and accurate`,
  ],
  new MessagesPlaceholder("history"),
  [
    "human",
    `Resume Context:
{ragContext}

Web Search Results:
{webContext}

Question: {question}

Answer:`,
  ],
]);

const RAG_ONLY_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a helpful assistant. Answer using resume context.
Consider conversation history for context.
Rules:
1. Use ONLY resume information
2. Reference previous points if relevant
3. Be concise and avoid repetition`,
  ],
  new MessagesPlaceholder("history"),
  [
    "human",
    `Resume Context:
{context}

Question: {question}

Answer:`,
  ],
]);

const JOB_SEARCH_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a job search assistant. Format and present job opportunities clearly.
Rules:
1. Extract job title, company name, location, salary (if available), and apply link
2. Match jobs to user skills from resume if available
3. Only include jobs user can apply for
4. If no relevant jobs found, say: "No matching job opportunities found."
5. Be concise and well-organized
6. Always include apply links for each job`,
  ],
  new MessagesPlaceholder("history"),
  [
    "human",
    `Job Search Results:
{jobResults}

Resume Context (Skills):
{resumeContext}

User Query: {question}

Format jobs as a clean, organized list with apply links and company details.

Answer:`,
  ],
]);

const combinedChain = COMBINED_PROMPT.pipe(llm);
const ragOnlyChain = RAG_ONLY_PROMPT.pipe(llm);
const jobSearchChain = JOB_SEARCH_PROMPT.pipe(llm);

interface CitedChunk {
  id: string;
  score: number;
  content: string;
  documentId: string;
  chunkIndex: number;
  source: "rag" | "web" | "job";
}

interface JobApplyOption {
  publisher: string;
  apply_link: string;
  is_direct: boolean;
}

interface JobData {
  job_id: string;
  job_title: string;
  job_description: string;
  employer_name: string;
  employer_logo?: string;
  employer_website?: string;
  job_country?: string;
  job_state?: string;
  job_city?: string;
  job_salary?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_apply_link: string;
  job_apply_is_direct: boolean;
  apply_options?: JobApplyOption[];
  job_employment_type: string;
  job_is_remote: boolean;
  job_posted_at: string;
  job_location: string;
  job_publisher?: string;
}

interface QuestionResponse {
  conversationId: string;
  answer: string;
  citedChunks: CitedChunk[];
  source: "rag" | "web" | "job" | "combined" | "error";
}

/**
 * Query analysis result from LLM
 */
interface QueryAnalysis {
  intent: "resume_query" | "career_guidance" | "job_search" | "irrelevant";
  confidence: number;
  rewrittenQuery: string;
  jobSearch?: {
    jobTitle?: string;
    location?: string;
    skills?: string[];
  };
  reasoning?: string;
}

/**
 * Analyze query using LLM to determine intent, confidence, and extract parameters
 * Makes a single LLM call that returns structured JSON
 */
async function analyzeQuery(question: string): Promise<QueryAnalysis> {
  const analysisPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are a query analysis system for a career/resume RAG application.
Your task is to analyze user queries and classify their intent.

INTENTS:
- resume_query: Questions about the user's own resume, experience, skills, education
- career_guidance: Career advice, professional development, industry insights
- job_search: User wants to find job opportunities, positions, roles
- irrelevant: Not related to career, resume, or job search

RULES:
1. Return ONLY valid JSON, no additional text
2. confidence must be between 0.0 and 1.0
3. rewrittenQuery should optimize the query for retrieval (remove filler words, clarify intent)
4. jobSearch object should ONLY be populated if intent === "job_search"
5. skills array should ONLY contain technical/professional skills mentioned in the query
6. If intent is "irrelevant" or confidence < 0.6, set confidence to 0.0

OUTPUT FORMAT (strict JSON):
{{
  "intent": "resume_query" | "career_guidance" | "job_search" | "irrelevant",
  "confidence": 0.0-1.0,
  "rewrittenQuery": "optimized query string",
  "jobSearch": {{
    "jobTitle": "optional job title",
    "location": "optional location",
    "skills": ["skill1", "skill2"]
  }},
  "reasoning": "brief explanation"
}}`,
    ],
    ["human", "Analyze this query: {question}"],
  ]);

  try {
    const analysisChain = analysisPrompt.pipe(llm);
    const response = await analysisChain.invoke({ question });

    let analysisText = extractAnswer(response);

    // Clean JSON response (remove markdown code blocks if present)
    analysisText = analysisText.trim();
    if (analysisText.startsWith("```json")) {
      analysisText = analysisText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "");
    } else if (analysisText.startsWith("```")) {
      analysisText = analysisText.replace(/```\n?/g, "");
    }

    const analysis: QueryAnalysis = JSON.parse(analysisText);

    // Validate and normalize
    if (
      !["resume_query", "career_guidance", "job_search", "irrelevant"].includes(
        analysis.intent
      )
    ) {
      analysis.intent = "irrelevant";
      analysis.confidence = 0.0;
    }

    if (analysis.confidence < 0 || analysis.confidence > 1) {
      analysis.confidence = analysis.intent === "irrelevant" ? 0.0 : 0.8;
    }

    if (
      !analysis.rewrittenQuery ||
      analysis.rewrittenQuery.trim().length === 0
    ) {
      analysis.rewrittenQuery = question;
    }

    // Clear jobSearch if intent is not job_search
    if (analysis.intent !== "job_search") {
      analysis.jobSearch = undefined;
    }

    // Ensure skills array exists for job_search
    if (analysis.intent === "job_search" && !analysis.jobSearch) {
      analysis.jobSearch = { skills: [] };
    } else if (
      analysis.intent === "job_search" &&
      !analysis.jobSearch?.skills
    ) {
      analysis.jobSearch = { ...analysis.jobSearch, skills: [] };
    }

    return analysis;
  } catch (error: any) {
    console.error("Query analysis error:", error.message);
    // Fallback to safe defaults
    return {
      intent: "irrelevant",
      confidence: 0.0,
      rewrittenQuery: question,
    };
  }
}

/**
 * Search using JSearch API
 */
async function searchWithJSearch(query: string): Promise<CitedChunk[]> {
  try {
    if (!process.env.JSEARCH_API_KEY) {
      console.warn("JSearch API key not configured");
      return [];
    }

    const requestUrl = new URL("https://jsearch.p.rapidapi.com/search");
    requestUrl.searchParams.append("query", query);
    requestUrl.searchParams.append("page", "1");
    requestUrl.searchParams.append("num_pages", "1");
    requestUrl.searchParams.append("country", "ind");
    requestUrl.searchParams.append("date_posted", "month");
    requestUrl.searchParams.append("language", "en");

    const response = await axios.get(requestUrl.toString(), {
      headers: {
        "x-rapidapi-host": "jsearch.p.rapidapi.com",
        "x-rapidapi-key": process.env.JSEARCH_API_KEY,
      },
    });

    if (
      response.data.status !== "OK" ||
      !response.data.data ||
      response.data.data.length === 0
    ) {
      return [];
    }

    const jobChunks: CitedChunk[] = response.data.data
      .slice(0, 10)
      .map((job: JobData, i: number) => {
        const salary = job.job_salary
          ? job.job_salary
          : job.job_min_salary
          ? `₹${job.job_min_salary.toLocaleString()}${
              job.job_max_salary
                ? `-₹${job.job_max_salary.toLocaleString()}`
                : ""
            }`
          : "Not specified";

        const location = job.job_location || "Remote";

        // Get best apply link (prefer direct apply)
        const bestApplyOption =
          job.apply_options?.find((opt) => opt.is_direct) ||
          job.apply_options?.[0];
        const applyLink = bestApplyOption?.apply_link || job.job_apply_link;

        const content = `
Job Title: ${job.job_title}
Company: ${job.employer_name}
Location: ${location}
Employment Type: ${job.job_employment_type}
Remote: ${job.job_is_remote ? "Yes" : "No"}
Salary: ${salary}
Posted: ${job.job_posted_at}
Publisher: ${job.job_publisher || "Job Board"}
Description: ${job.job_description.substring(0, 400)}...
Apply Link: ${applyLink}
Direct Apply: ${job.job_apply_is_direct ? "Yes" : "No"}`;

        return {
          id: job.job_id,
          score: 1 - i * 0.05,
          content: content.trim(),
          documentId: `job_${job.job_id}`,
          chunkIndex: i,
          source: "job" as const,
        };
      });

    return jobChunks;
  } catch (error: any) {
    console.error("JSearch API error:", error.message);
    return [];
  }
}

/**
 * Search using Serper API for general queries
 */
async function searchWithSerper(query: string): Promise<CitedChunk[]> {
  try {
    if (!process.env.SERPER_API_KEY) {
      return [];
    }

    const response = await axios.post(
      "https://google.serper.dev/search",
      {
        q: query,
        num: 10,
      },
      {
        headers: {
          "X-API-KEY": process.env.SERPER_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.data.organic || response.data.organic.length === 0) {
      return [];
    }

    const webChunks: CitedChunk[] = response.data.organic
      .slice(0, 10)
      .map((result: any, i: number) => ({
        id: `web_result_${i}`,
        score: 1 - i * 0.05,
        content: `${result.title}\n${result.snippet}`,
        documentId: "web",
        chunkIndex: i,
        source: "web" as const,
      }));

    return webChunks;
  } catch (error: any) {
    console.error("Serper API error:", error.message);
    return [];
  }
}

/**
 * Check if context is relevant
 */
function isContextRelevant(chunks: any[]): boolean {
  if (chunks.length === 0) return false;
  const relevantChunks = chunks.filter((c) => c.score >= MIN_SCORE);
  return relevantChunks.length >= 2;
}

/**
 * Generate a meaningful conversation title from the question
 */
function generateConversationTitle(question: string, source?: string): string {
  // Clean and truncate the question
  let title = question.trim();

  // Remove question marks and extra whitespace
  title = title.replace(/\?+$/, "").trim();

  // Add prefix based on source/type (will be updated by analyzeQuery in actual flow)
  if (
    title.toLowerCase().includes("resume") ||
    title.toLowerCase().includes("experience")
  ) {
    title = `Resume Q: ${title}`;
  }

  // Truncate to 60 characters, preserving word boundaries
  if (title.length > 60) {
    title = title.substring(0, 57).trim();
    const lastSpace = title.lastIndexOf(" ");
    if (lastSpace > 40) {
      title = title.substring(0, lastSpace);
    }
    title += "...";
  }

  return title || "New Conversation";
}

/**
 * Update conversation title if it's still the default
 */
async function updateConversationTitleIfNeeded(
  conversationId: string,
  question: string,
  source?: string
): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) return;

    // Only update if it's still the default title format
    const isDefaultTitle = conversation.title?.startsWith("Chat - ");

    if (isDefaultTitle) {
      const newTitle = generateConversationTitle(question, source);
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { title: newTitle },
      });
    }
  } catch (error: any) {
    console.error("Failed to update conversation title:", error.message);
    // Don't throw - title update is not critical
  }
}

/**
 * Create or get conversation
 */
async function getOrCreateConversation(
  userId: string,
  conversationId?: string,
  resumeId?: string
): Promise<string> {
  if (conversationId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (conversation) return conversationId;
  }

  const newConversation = await prisma.conversation.create({
    data: {
      userId,
      resumeId: resumeId || null,
      title: `Chat - ${new Date().toLocaleString()}`,
    },
  });

  return newConversation.id;
}

/**
 * Save message to database
 */
async function saveMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  text: string,
  source: string,
  citedChunks: CitedChunk[]
): Promise<string> {
  try {
    const citedChunksData =
      citedChunks.length > 0
        ? citedChunks.map((chunk) => ({
            id: chunk.id,
            score: chunk.score,
            content: chunk.content,
            documentId: chunk.documentId,
            chunkIndex: chunk.chunkIndex,
            source: chunk.source,
          }))
        : null;

    const message = await prisma.message.create({
      data: {
        conversationId,
        role,
        text,
        source,
        citedChunks: citedChunksData as any,
      },
    });

    return message.id;
  } catch (error: any) {
    console.error("Failed to save message:", error.message);
    throw error;
  }
}

/**
 * Fetch recent conversation history
 */
async function getConversationHistory(
  conversationId: string,
  limit: number = MAX_HISTORY_MESSAGES
): Promise<BaseMessage[]> {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    if (messages.length === 0) return [];

    const reversedMessages = messages.reverse();

    return reversedMessages.map((msg) => {
      if (msg.role === "user") {
        return new HumanMessage(msg.text);
      } else if (msg.role === "assistant") {
        return new AIMessage(msg.text);
      } else {
        return new HumanMessage(msg.text);
      }
    });
  } catch (error: any) {
    console.error("Failed to fetch conversation history:", error.message);
    return [];
  }
}

/**
 * Estimate token count
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Filter history by token limit
 */
function filterHistoryByTokens(
  messages: BaseMessage[],
  maxTokens: number = MAX_TOKENS_HISTORY
): BaseMessage[] {
  let totalTokens = 0;
  const result: BaseMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokenCount(messages[i].content as string);

    if (totalTokens + msgTokens > maxTokens) {
      break;
    }

    result.unshift(messages[i]);
    totalTokens += msgTokens;
  }

  return result;
}

/**
 * Ask a question with conversation history
 */
export async function askQuestion(
  question: string,
  userId: string,
  conversationId?: string,
  resumeId?: string
): Promise<QuestionResponse> {
  if (!question?.trim()) {
    return {
      conversationId: "",
      answer: "Please provide a valid question.",
      citedChunks: [],
      source: "error",
    };
  }

  try {
    const finalConversationId = await getOrCreateConversation(
      userId,
      conversationId,
      resumeId
    );

    await saveMessage(finalConversationId, "user", question, "user", []);

    // Step 1: Analyze query with single LLM call
    const analysis = await analyzeQuery(question);
    console.log(analysis);
    console.log(
      `Query analysis: intent=${analysis.intent}, confidence=${analysis.confidence}`
    );

    // Step 2: Apply guardrails - early exit for irrelevant or low confidence
    if (analysis.intent === "irrelevant" || analysis.confidence < 0.6) {
      const guardrailMessage =
        "I can only help with questions related to your resume, career guidance, or job search. Please ask a relevant question.";

      await saveMessage(
        finalConversationId,
        "assistant",
        guardrailMessage,
        "error",
        []
      );

      await updateConversationTitleIfNeeded(
        finalConversationId,
        question,
        "error"
      );

      return {
        conversationId: finalConversationId,
        answer: guardrailMessage,
        citedChunks: [],
        source: "error",
      };
    }

    // Step 2.5: Check semantic cache for similar queries
    const cachedResponse = await cache.getCachedResponse(question, userId);
    if (cachedResponse) {
      // Use cached conversation ID if available, otherwise use current one
      const responseConversationId =
        cachedResponse.conversationId || finalConversationId;

      // Save cached response as a new message in the conversation
      await saveMessage(
        finalConversationId,
        "assistant",
        cachedResponse.answer,
        cachedResponse.source,
        cachedResponse.citedChunks
      );

      const cachedReturn: QuestionResponse = {
        conversationId: responseConversationId,
        answer: cachedResponse.answer,
        citedChunks: cachedResponse.citedChunks,
        source: cachedResponse.source as
          | "rag"
          | "web"
          | "job"
          | "combined"
          | "error",
      };

      return cachedReturn;
    }
    let history = await getConversationHistory(finalConversationId);
    history = filterHistoryByTokens(history);

    // Step 3: Use rewritten query for downstream calls
    const queryToUse = analysis.rewrittenQuery || question;

    // Step 4: Route based on intent
    if (analysis.intent === "job_search") {
      // Search jobs using JSearch API with rewritten query
      const jobChunks = await searchWithJSearch(queryToUse);

      if (jobChunks.length > 0) {
        // Get RAG context for resume skills matching (use skills from analysis if available)
        const skillsToQuery =
          analysis.jobSearch?.skills && analysis.jobSearch.skills.length > 0
            ? analysis.jobSearch.skills.join(" ")
            : queryToUse;

        const ragResults = await queryRAG(skillsToQuery, {
          topK: 5,
          filter: {
            userId,
            resumeId,
          },
        });

        const resumeContext = ragResults
          .filter((r) => r.score >= MIN_SCORE)
          .map((c) => c.content)
          .join("\n");

        const jobResults = jobChunks
          .map((c, i) => `[${i + 1}] ${c.content}`)
          .join("\n\n");

        const response = await jobSearchChain.invoke({
          history,
          question: queryToUse,
          jobResults,
          resumeContext: resumeContext || "No resume data available",
        });

        const answer = extractAnswer(response);

        if (answer && answer.length > 10) {
          await saveMessage(
            finalConversationId,
            "assistant",
            answer,
            "job",
            jobChunks
          );

          await updateConversationTitleIfNeeded(
            finalConversationId,
            question,
            "job"
          );

          const response: QuestionResponse = {
            conversationId: finalConversationId,
            answer,
            citedChunks: jobChunks,
            source: "job",
          };

          // Store in semantic cache
          cache.storeQueryResponse(question, response, userId);

          return response;
        }
      }
    }

    // Step 5: Route resume_query and career_guidance to RAG pipeline
    // Use rewritten query for better retrieval
    const ragResults = await queryRAG(queryToUse, {
      topK: TOP_K * 2,
      filter: {
        userId,
      },
    });
    const webChunks: CitedChunk[] = []; // searchWithSerper(queryToUse) disabled for now

    const ragRelevant = isContextRelevant(ragResults);
    const webRelevant = webChunks.length > 0;

    // Case 1: Both RAG and Web have relevant context
    if (ragRelevant && webRelevant) {
      const goodRagChunks = ragResults
        .filter((r) => r.score >= MIN_SCORE)
        .slice(0, TOP_K);

      const ragContext = goodRagChunks
        .map((c, i) => `[${i + 1}] ${c.content.trim()}`)
        .join("\n\n");

      const webContext = webChunks
        .map((c, i) => `[${i + 1}] ${c.content}`)
        .join("\n\n");

      const response = await combinedChain.invoke({
        history,
        question: queryToUse,
        ragContext,
        webContext,
      });

      const answer = extractAnswer(response);

      if (answer && answer.length > 10) {
        const citedChunks: CitedChunk[] = [
          ...goodRagChunks.map((chunk) => ({
            id: chunk.id,
            score: chunk.score,
            content: chunk.content,
            documentId: chunk.documentId,
            chunkIndex: chunk.chunkIndex,
            source: "rag" as const,
          })),
          ...webChunks.slice(0, 3).map((chunk) => ({
            ...chunk,
            source: "web" as const,
          })),
        ];

        await saveMessage(
          finalConversationId,
          "assistant",
          answer,
          "combined",
          citedChunks
        );

        await updateConversationTitleIfNeeded(
          finalConversationId,
          question,
          "combined"
        );

        const response: QuestionResponse = {
          conversationId: finalConversationId,
          answer,
          citedChunks,
          source: "combined",
        };

        // Store in semantic cache (only for newly generated responses, not cache hits)
        await cache.storeQueryResponse(question, response, userId);

        return response;
      }
    }

    // Case 2: Only RAG has relevant context
    if (ragRelevant && !webRelevant) {
      const goodRagChunks = ragResults
        .filter((r) => r.score >= MIN_SCORE)
        .slice(0, TOP_K);

      const context = goodRagChunks
        .map((c, i) => `[${i + 1}] ${c.content.trim()}`)
        .join("\n\n");

      const response = await ragOnlyChain.invoke({
        history,
        question: queryToUse,
        context,
      });

      const answer = extractAnswer(response);

      if (
        answer &&
        answer.length > 10 &&
        !answer.includes("don't have enough")
      ) {
        const citedChunks: CitedChunk[] = goodRagChunks.map((chunk) => ({
          id: chunk.id,
          score: chunk.score,
          content: chunk.content,
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          source: "rag" as const,
        }));

        await saveMessage(
          finalConversationId,
          "assistant",
          answer,
          "resume",
          citedChunks
        );

        await updateConversationTitleIfNeeded(
          finalConversationId,
          question,
          "rag"
        );

        const response: QuestionResponse = {
          conversationId: finalConversationId,
          answer,
          citedChunks,
          source: "rag",
        };

        // Store in semantic cache
        await cache.storeQueryResponse(question, response, userId);

        return response;
      }
    }

    // Case 3: Only Web has relevant context
    if (!ragRelevant && webRelevant) {
      const webContext = webChunks
        .map((c, i) => `[${i + 1}] ${c.content}`)
        .join("\n\n");

      const response = await ragOnlyChain.invoke({
        history,
        question,
        context: webContext,
      });

      const answer = extractAnswer(response);

      if (answer && answer.length > 10) {
        await saveMessage(
          finalConversationId,
          "assistant",
          answer,
          "web",
          webChunks
        );

        await updateConversationTitleIfNeeded(
          finalConversationId,
          question,
          "web"
        );

        const response: QuestionResponse = {
          conversationId: finalConversationId,
          answer,
          citedChunks: webChunks,
          source: "web",
        };

        // Store in semantic cache (only for newly generated responses, not cache hits)
        await cache.storeQueryResponse(question, response, userId);

        return response;
      }
    }

    // Case 4: Neither has relevant context
    const errorAnswer =
      "I don't have enough information to answer this question. Please try a different question or provide more context.";

    await saveMessage(
      finalConversationId,
      "assistant",
      errorAnswer,
      "error",
      []
    );

    await updateConversationTitleIfNeeded(
      finalConversationId,
      question,
      "error"
    );

    return {
      conversationId: finalConversationId,
      answer: errorAnswer,
      citedChunks: [],
      source: "error",
    };
  } catch (error: any) {
    console.error("Question answering error:", error.message);
    return {
      conversationId: "",
      answer: "Sorry, something went wrong. Please try again later.",
      citedChunks: [],
      source: "error",
    };
  }
}

/**
 * Extract text from LLM response
 */
function extractAnswer(response: any): string {
  if (typeof response.content === "string") {
    return response.content;
  }
  if (Array.isArray(response.content)) {
    return response.content.map((block: any) => block.text || "").join("");
  }
  return String(response.content || "");
}
