import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import createEmbaddingRoute from "./routes/CreateEmbedding";
import askRoute from "./routes/ask";
import userRoute from "./routes/user";
import conversationRoute from "./routes/conversation";

dotenv.config();
const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json());

app.use(
  "/api/v1",
  createEmbaddingRoute,
  askRoute,
  userRoute,
  conversationRoute
);
// app.use("/api/v1",)

const port = process.env.PORT || 5080;

app.listen(port, () => {
  console.log("Server run at port :", port);
});
