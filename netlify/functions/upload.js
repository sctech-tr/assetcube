const { createClient } = require("@supabase/supabase-js");
const Busboy = require("busboy");
const path = require("path");

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const busboy = Busboy({ headers: event.headers });
  let uploadKey, username, fileBuffer, filename, mimetype;

  await new Promise((resolve, reject) => {
    busboy.on("field", (fieldname, val) => {
      if (fieldname === "uploadKey") uploadKey = val;
      if (fieldname === "username") username = val;
    });

    busboy.on("file", (fieldname, file, info) => {
      filename = info.filename;
      mimetype = info.mimeType;

      if (!ALLOWED_MIME_TYPES.includes(mimetype)) {
        file.resume(); // Skip reading further
        return reject(new Error("Invalid file type"));
      }

      const chunks = [];
      let uploadedSize = 0;
      file.on("data", (data) => {
        uploadedSize += data.length;
        if (uploadedSize > MAX_FILE_SIZE) {
          file.resume();
          return reject(new Error("File too large"));
        }
        chunks.push(data);
      });

      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on("finish", resolve);
    busboy.on("error", reject);

    busboy.end(Buffer.from(event.body, "base64"));
  }).catch((err) => {
    return {
      statusCode: 400,
      body: err.message === "Invalid file type" ? "Only image files allowed" : "File too large (max 2MB)",
    };
  });

  if (!uploadKey || !username || !fileBuffer) {
    return { statusCode: 400, body: "Missing fields or invalid file" };
  }

  const { data: keyData, error: keyError } = await supabase
    .from("upload_keys")
    .select("upload_key")
    .eq("username", username)
    .single();

  if (keyError || !keyData || keyData.upload_key !== uploadKey) {
    return { statusCode: 403, body: "Invalid upload key" };
  }

  const bucket = process.env.SUPABASE_BUCKET || "uploads";
  const base = path.parse(filename).name;
  const ext = path.parse(filename).ext;
  let finalName = filename;
  let counter = 1;

  while (true) {
    const { data: exists } = await supabase.storage
      .from(bucket)
      .list(username, { search: finalName });

    if (!exists || exists.length === 0) break;

    finalName = `${base}(${counter})${ext}`;
    counter++;
  }

  const renamed = finalName !== filename;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(`${username}/${finalName}`, fileBuffer, {
      contentType: mimetype,
      upsert: true,
    });

  if (uploadError) {
    return { statusCode: 500, body: "Upload failed" };
  }

  const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${username}/${finalName}`;
  const assetcubeUrl = `https://assetcube.netlify.app/u/${username}/${finalName}`;
  
  return {
    statusCode: 200,
    body: JSON.stringify({ url: assetcubeUrl, renamed }),
  };
};
