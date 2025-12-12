import { Router } from "express";
import { listResumes } from "../controller/resumeController";
import { verifyAccessToken } from "../middleware/jwtVerification";

const router = Router();

router.get("/resumes", verifyAccessToken, listResumes);

export = router;
