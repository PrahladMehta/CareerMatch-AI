
import { Router } from "express";
import { askController } from "../controller/askController";

const router=Router();

router.post ("/query",askController);

export=router;