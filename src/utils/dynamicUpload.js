import multer from "multer";
import path from "node:path";
import fs from "node:fs";

import Settings from "../models/Settings.js";

const uploadPath = path.resolve(process.env.UPLOAD_DIR || "./uploads");
fs.mkdirSync(uploadPath, { recursive: true });

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
    destination: (_req, _file, cb) => cb(null, uploadPath),
    filename: (_req, file, cb) =>
      cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  });

  try {
    const { general: generalSettings } = await Settings.findOne({ key: "global" }).select(
      "general",
    );

    const maxMB = Number(generalSettings?.maxFileSizeMB) || 10;
    const MAX_FILES = 5;

    const allowed = new Set(
      generalSettings?.allowedFileTypes
        .map((t) => MIMETYPE_EXENSION[t.toLowerCase()])
        .filter(Boolean),
    );

    const uploadMiddleware = multer({
      storage,
      limits: {
        fileSize: maxMB * 1024 * 1024,
        files: MAX_FILES,
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
    }).array("attachments", MAX_FILES);

    uploadMiddleware(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: `File size exceeds the maximum allowed size of ${maxMB}MB.`,
            code: error.code,
          });
        }
      }

      if (error.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({
          success: false,
          message: `You can upload a maximum of ${MAX_FILES} files.`,
          code: error.code,
        });
      }

      return res.status(400).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    });
  } catch (error) {
    next(error);
  }
};
