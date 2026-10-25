import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, unique: true },
    category: { type: String, default: "General" },
    summary: String,
    body: { type: String, required: true },
    tags: [String],
    published: { type: Boolean, default: false },
    createdBy: String,
    updatedBy: String,
  },
  { timestamps: true },
);
export default mongoose.model("KnowledgeArticle", schema);
