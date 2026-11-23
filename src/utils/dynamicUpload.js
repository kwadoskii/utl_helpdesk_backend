import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import Settings from "../models/Settings.js";

const uploadPath = path.resolve(process.env.UPLOAD_DIR || "./uploads");

fs.mkdirSync(uploadPath, { recursive: true });

const MIMETYPE_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

const MAX_FILES = 5;

export const dynamicUpload = async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ key: "global" }).select("general").lean();

    const generalSettings = settings?.general || {};

    const maxMB = Number(generalSettings.maxFileSizeMB) || 10;

    const allowed = new Set(
      (generalSettings.allowedFileTypes || [])
        .map((type) => MIMETYPE_EXTENSION[type.toLowerCase()])
        .filter(Boolean),
    );

    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => {
        cb(null, uploadPath);
      },

      filename: (_req, file, cb) => {
        cb(null, randomUUID() + path.extname(file.originalname).toLowerCase());
      },
    });

    const uploadMiddleware = multer({
      storage,

      limits: {
        fileSize: maxMB * 1024 * 1024,
        files: MAX_FILES,
      },

      fileFilter: (_req, file, cb) => {
        if (!allowed.has(file.mimetype)) {
          const error = new Error(`Unsupported attachment type: ${file.originalname}`);

          error.status = 400;

          return cb(error);
        }

        cb(null, true);
      },
    }).array("attachments", MAX_FILES);

    uploadMiddleware(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError) {
          const messages = {
            LIMIT_FILE_SIZE: `File size exceeds the maximum allowed size of ${maxMB}MB.`,
            LIMIT_FILE_COUNT: `You can upload a maximum of ${MAX_FILES} files.`,
            LIMIT_UNEXPECTED_FILE: "Unexpected file field.",
          };

          return res.status(400).json({
            success: false,
            message: messages[error.code] || error.message,
            code: error.code,
          });
        }

        return res.status(error.status || 400).json({
          success: false,
          message: error.message || "File upload failed.",
        });
      }

      next();
    });
  } catch (error) {
    next(error);
  }
};
