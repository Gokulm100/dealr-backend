import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
        const isImage = file.mimetype?.startsWith('image/');
        if (!isImage) {
            throw new Error('Only image files are allowed!');
        }

        return {
            folder: process.env.CLOUDINARY_FOLDER || 'dealr',
            resource_type: 'image',
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
            transformation: [
                {
                    quality: 'auto:eco',
                    width: 1600,
                    height: 1600,
                    crop: 'limit'
                }
            ]
        };
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        files: 5
    }
});

/** In-memory upload for AI image analysis (not persisted to Cloudinary). */
export const memoryUpload = multer({
    storage: multer.memoryStorage(),
    fileFilter,
    limits: {
        files: 5,
        fileSize: 8 * 1024 * 1024,
    },
});

export default upload;