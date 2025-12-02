
import express,{Request,Response} from "express";
import cors from "cors";
import dotenv from "dotenv";
import  createEmbaddingRoute from "./routes/CreateEmbedding";
import askRoute from "./routes/ask"
import userRoute from "./routes/user";

dotenv.config();
const app=express(); 

app.use(cors());
app.use(express.json());

app.use("/api/v1",createEmbaddingRoute,askRoute,userRoute);
// app.use("/api/v1",)


const port=process.env.PORT||5080

app.listen(port,()=>{
      console.log("Server run at port :",port);
})