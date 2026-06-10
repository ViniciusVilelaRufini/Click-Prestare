/**
 * Compresses an image (base64 data URL or File object) to a target maximum size (width/height)
 * and JPEG quality, returning a Promise that resolves with the compressed base64 string.
 */
export function compressImage(
  dataUrlOrFile: string | File,
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Calculate new dimensions keeping aspect ratio
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(typeof dataUrlOrFile === 'string' ? dataUrlOrFile : '');
        return;
      }

      // Fill background with white in case of transparent png
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);

      ctx.drawImage(img, 0, 0, width, height);
      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(compressedDataUrl);
    };

    img.onerror = (err) => {
      reject(err);
    };

    if (dataUrlOrFile instanceof File) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        img.src = e.target.result;
      };
      reader.onerror = (err) => {
        reject(err);
      };
      reader.readAsDataURL(dataUrlOrFile);
    } else {
      img.src = dataUrlOrFile;
    }
  });
}
