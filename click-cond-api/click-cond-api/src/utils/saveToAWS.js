const AWS = require('aws-sdk');

/**
 * Upload image to AWS S3
 * @param {String} base64 Full base64 string
 * @param {String} folder Name of the folder at AWS Bucket
 * @param {String} name Name of file
 * @param {String} id ID to differentiate files 
 * @return {Promise} Return the public URL and name from the file
 */
module.exports = (base64, folder, name, id) => {
  if (!base64.includes('base64')) return { url: base64 };
  const {
    AWS_S3_BUCKET_NAME: bktName,
    AWS_S3_BASE_URL: baseS3Url,
    AWS_ACCESS_KEY: awsKey,
    AWS_SECRET_KEY: awsSecret,
    AWS_S3_BUCKET_REGION: bktRegion, 
  } = process.env;

  if (
    !bktName &&
    !baseS3Url &&
    !awsKey &&
    !awsSecret &&
    !bktRegion
  ) return false;

  AWS.config.update({
    region: bktRegion,
    credentials: {
      accessKeyId: awsKey,
      secretAccessKey: awsSecret,
    }
  })

  const fileType = base64.split(';')[0].split('/')[1];
  const applicationType = base64.split(';')[0].split(':')[1];
  // Clean the base64 string by removing any data URI scheme prefix (e.g. data:image/jpeg;base64,)
  const base64Clean = base64.replace(/^data:[a-zA-Z0-9.\-\/+]+;base64,/, '');
  const base64Data = Buffer.from(base64Clean, 'base64');

  console.log(base64Data);
  // console.log(fileType);

  const S3 = new AWS.S3();

  return new Promise((resolve, reject) => {
    S3.upload({
      Bucket: bktName,
      Body: base64Data,
      Key: `dev/${folder}/${name}-${Date.now()}.${fileType}`,
      ContentEncoding: 'base64',
      ContentType: applicationType,
      ACL: 'public-read',
    }, (err, data) => {
      console.log(1)
      console.log(data);
      console.log(err)
      if (err)  reject(err);
      else      resolve({ url: data.Location, name: data.key });
    });
  })
}