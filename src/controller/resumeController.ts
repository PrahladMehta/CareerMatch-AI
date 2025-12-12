import { Request, Response } from "express";
import prisma from "../utils/prisma";

type AuthedRequest = Request & { userId?: string };

/**
 * GET /api/v1/resumes
 * Returns list of resumes for the authenticated user (only id and name)
 */
export async function listResumes(
  req: AuthedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const resumes = await prisma.resume.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
      },
    });

    const payload = resumes.map((resume) => ({
      resumeId: resume.id,
      name: resume.name,
    }));

    res.json({ resumes: payload });
  } catch (error: any) {
    console.error("listResumes error:", error.message);
    res.status(500).json({ error: "Failed to fetch resumes" });
  }
}
