import multer from "multer";
import path from "node:path";
import fs from "node:fs";

import Settings from "../models/Settings.js";

const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "./uploads");
fs.mkdirSync(uploadRoot, { recursive: true });

const MIMETYPE_EXENSION = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

export const dynamicUpload = async (req, res, next) => {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot),
    filename: (_req, file, cb) =>
      cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  });

  try {
    const { general: generalSettings } = await Settings.findOne({ key: "global" }).select(
      "general",
    );

    const maxMB = Number(generalSettings?.maxFileSizeMB) || 10;
    const allowed = new Set(
      generalSettings?.allowedFileTypes
        .map((t) => MIMETYPE_EXENSION[t.toLowerCase()])
        .filter(Boolean),
    );

    const uploadMiddleware = multer({
      storage,
      limits: {
        fileSize: maxMB * 1024 * 1024,
        files: 5,
      },
      fileFilter: (_req, file, cb) => {
        if (!allowed.has(file.mimetype)) {
          console.log({ allowed, maxMB, fileMimeType: file.mimetype });
          const error = new Error(`Unsupported attachment type: ${file.originalname}`);
          error.status = 400;
          return cb(error);
        }

        cb(null, true);
      },
    }).array("attachments", 5);

    uploadMiddleware(req, res, next);
  } catch (error) {
    next(error);
  }
};
