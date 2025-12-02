
import { Router } from "express";
import multer from "multer";
import { pdfToEmbed } from "../controller/CreateEmbedding";
import {verifyAccessToken} from "../middleware/jwtVerification"

const router=Router();

const upload = multer({ storage: multer.memoryStorage() }); 

router.post("/upload-content",upload.single('file'),verifyAccessToken,pdfToEmbed);

export=router;