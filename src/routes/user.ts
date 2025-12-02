import express from 'express';
import { createUser,loginUser,refreshAccessToken } from '../controller/userController';
const router = express.Router();

router.post('/create', createUser);
router.post('/login',loginUser); // Placeholder for login controller
router.post('/refresh-token', refreshAccessToken); // Placeholder for refresh token controller
export default router;