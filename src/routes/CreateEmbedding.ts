
import { Router } from "express";
import multer from "multer";
import { pdfToEmbed } from "../controller/CreateEmbedding";

const router=Router();

const upload = multer({ storage: multer.memoryStorage() }); 

router.post("/upload-content",upload.single('file'),pdfToEmbed);

export=router;