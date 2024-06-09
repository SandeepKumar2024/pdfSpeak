import { db } from '@/db';
import { getKindeServerSession } from '@kinde-oss/kinde-auth-nextjs/server';
import {
  createUploadthing,
  type FileRouter,
} from 'uploadthing/next'
import { PDFLoader } from 'langchain/document_loaders/fs/pdf';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { getPineconeClient } from '@/lib/pinecone';


const f = createUploadthing();

const middleware = async () => {
  const { getUser } = getKindeServerSession();
  const user = getUser();

  if (!user || !user.id) {
    throw new Error('Unauthorized');
  }

  return { userId: user.id };
};

const onUploadComplete = async ({
  metadata,
  file,
}: {
  metadata: Awaited<ReturnType<typeof middleware>>;
  file: {
    key: string;
    name: string;
    url: string;
  };
}) => {
  const isFileExist = await db.file.findFirst({
    where: {
      key: file.key,
    },
  });

  if (isFileExist) {
    console.log('File already exists in the database:', file.key);
    return;
  }

  const createdFile = await db.file.create({
    data: {
      key: file.key,
      name: file.name,
      userId: metadata.userId,
      url: `https://utfs.io/f/${file.key}`,
      uploadStatus: 'PROCESSING',
    },
  });

  try {
    console.log('Fetching file from S3:', file.key);
    const response = await fetch(`https://utfs.io/f/${file.key}`);
    const blob = await response.blob();

    console.log('Loading PDF with PDFLoader');
    const loader = new PDFLoader(blob);
    const pageLevelDocs = await loader.load();

    console.log('Number of pages in PDF:', pageLevelDocs.length);

    // Vectorize and index the entire document
    console.log('Vectorizing and indexing document');

    const pinecone = await getPineconeClient()
    console.log("pincone ",pinecone)
    const pineconeIndex = pinecone.Index('pdf')
    console.log('Pinecone index accessed:', pineconeIndex);
    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    await PineconeStore.fromDocuments(pageLevelDocs, embeddings, {
      
      pineconeIndex,
      namespace:createdFile.id
    });

    await db.file.update({
      data: {
        uploadStatus: 'SUCCESS',
      },
      where: {
        id: createdFile.id,
      },
    });
    console.log('Upload status:', db.file);
  } catch (error) {
    console.error('Error processing upload:', error);
    await db.file.update({
      data: {
        uploadStatus: 'FAILED',
      },
      where: {
        id: createdFile.id,
      },
    });
  }
};

// Define OurFileRouter object
export const ourFileRouter = {
  freePlanUploader: f({ pdf: { maxFileSize: '16MB' } })
    .middleware(middleware)
    .onUploadComplete(onUploadComplete),

} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;



