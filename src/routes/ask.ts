
import { Router } from "express";
import { askController } from "../controller/askController";
import { verifyAccessToken } from "../middleware/jwtVerification";

const router=Router();

router.post ("/query",verifyAccessToken,askController);

export=router;