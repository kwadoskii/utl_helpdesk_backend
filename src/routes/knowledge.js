import { Router } from "express";
import slugify from "slugify";
import { randomBytes } from "crypto";
import KnowledgeArticle from "../models/KnowledgeArticle.js";
import { requireSupport } from "../middleware/auth.js";
const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const filter = { published: true };
    if (req.query.q) filter.$text = { $search: String(req.query.q) };
    if (req.query.category) filter.category = req.query.category;
    res.json(
      await KnowledgeArticle.find(filter)
        .select("title slug category summary tags updatedAt")
        .sort({ updatedAt: -1 })
        .limit(100),
    );
  } catch (e) {
    next(e);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const article = await KnowledgeArticle.findOne({ slug: req.params.slug, published: true });

    if (!article) return res.status(404).json({ message: "Article not found." });

    res.json(article);
  } catch (e) {
    next(e);
  }
});

router.post("/", requireSupport, async (req, res, next) => {
  try {
    const uniqueId = randomBytes(4).toString("hex");

    const slug = `${slugify(req.body.title, {
      lower: true,
      strict: true,
    })}-${uniqueId}`;

    const article = await KnowledgeArticle.create({
      ...req.body,
      slug,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    res.status(201).json({
      message: "Knowledge Base article created successfully",
      article,
    });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", requireSupport, async (req, res, next) => {
  try {
    const article = await KnowledgeArticle.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedBy: req.user.id },
      { new: true, runValidators: true },
    );
    if (!article) return res.status(404).json({ message: "Article not found." });
    res.json(article);
  } catch (e) {
    next(e);
  }
});

export default router;
