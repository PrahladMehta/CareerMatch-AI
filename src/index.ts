
import express,{Request,Response} from "express";
import cors from "cors";
import dotenv from "dotenv";
import  createEmbaddingRoute from "./routes/CreateEmbadding";


dotenv.config();
const app=express();    

app.use(cors());
app.use(express.json());

app.use("/api/v1",createEmbaddingRoute);


const port=process.env.PORT||5080

app.listen(port,()=>{
      console.log("Server run at port :",port);
})