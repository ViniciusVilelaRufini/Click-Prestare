require("dotenv").config();
const AWS = require("aws-sdk");

const mimeTypesAllowed = {
  jpeg: {
    extension: ".jpeg",
    contentType: "image/jpeg",
  },
  jpg: {
    extension: ".jpg",
    contentType: "image/jpeg",
  },
  png: {
    extension: ".png",
    contentType: "image/png",
  },
  // pdf: {
  //   extension: ".pdf",
  //   contentType: "application/pdf",
  // },
};

const bucketName = process.env.AWS_S3_BUCKET_NAME;
const baseS3Url = process.env.AWS_S3_BASE_URL;
AWS.config.update({
  accessKeyId: process.env.AWS_S3_API_KEY,
  secretAccessKey: process.env.AWS_S3_API_SECRET,
  region: process.env.AWS_S3_BUCKET_REGION,
});
const S3 = new AWS.S3();
const baseFolder = process.env.NODE_ENV || "some_env";

// async function storeFile({ file, ext, type, fileName, setPublic, subFolder }) {
//   let basePath = `${baseFolder}/${type}${subFolder && `/${subFolder}`}`;
//   fileName = fileName || generateToken(48);

//   let filePath = `${basePath}/${fileName}.${ext}`;

//   // console.log(filePath);
//   var params = {
//     Bucket: bucketName,
//     Body: file,
//     Key: filePath,
//   };
//   if (setPublic) {
//     params.ACL = "public-read";
//   }

//   try {
//     const data = await S3.upload(params).promise();
//     console.log("Uploaded to S3: " + data.Location);
//     return filePath;
//   } catch (error) {
//     console.log(error);
//     throw error;
//   }
// }

exports.createSignedUrl = async function createSignedUrl(fileType) {
  if (!fileType) throw "WRONG_TYPE";

  fileType = fileType.toLowerCase();

  const typeInfo = mimeTypesAllowed[fileType];

  if (!typeInfo) throw "TYPE_NOT_ALLOWED";

  const filename =
    generateToken(15) +
    new Date().getTime() +
    generateToken(15) +
    typeInfo.extension;
  const fullS3Path = baseFolder + "/" + filename;

  const acl = "public-read";

  const params = {
    Bucket: bucketName,
    Key: fullS3Path,
    ContentType: typeInfo.contentType,
    Expires: 300,
    ACL: acl,
  };

  return new Promise((resolve, reject) => {
    S3.getSignedUrl("putObject", params, (err, url) => {
      if (err) return reject(err);
      console.log("generated url " + url);
      resolve({
        url: url,
        name: filename,
        resolvedUrl: baseS3Url + fullS3Path,
        public: true,
        contentType: typeInfo.contentType,
      });
    });
  });
};

// function getUrlFor(path) {
//   return baseS3Url + path;
// }

const chars = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
];

function generateToken(len) {
  return [...Array(len)]
    .map((i) => chars[(Math.random() * chars.length) | 0])
    .join("");
}
