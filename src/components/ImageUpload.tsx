import { memo } from "react";
import { useCallback, memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, X, Image as ImageIcon } from "lucide-react";

interface ImageUploadProps {
  onImageUpload: (file: File | null) => void;
  uploadedImage: File | null;
}

const ImageUploadComponent = ({ onImageUpload, uploadedImage }: ImageUploadProps) => {
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onImageUpload(file);
    }
  }, [onImageUpload]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onImageUpload(file);
    }
  }, [onImageUpload]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const removeImage = useCallback(() => {
    onImageUpload(null);
  }, [onImageUpload]);

  const imageUrl = uploadedImage ? URL.createObjectURL(uploadedImage) : null;

  return (
    <div className="space-y-4">
      {!uploadedImage ? (
        <Card className="border-2 border-dashed border-blue-300 hover:border-blue-400 transition-colors">
          <CardContent className="p-8">
            <div
              className="text-center space-y-4 cursor-pointer"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                <Upload className="h-8 w-8 text-blue-600" />
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-700 mb-2">
                  Upload your trading card image
                </p>
                <p className="text-sm text-gray-500 mb-4">
                  Drag and drop or click to select a file
                </p>
                <Button variant="outline" className="bg-white hover:bg-gray-50">
                  <ImageIcon className="h-4 w-4 mr-2" />
                  Choose Image
                </Button>
              </div>
              <p className="text-xs text-gray-400">
                Supports JPG, PNG, GIF up to 10MB
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="relative">
              <img
                src={imageUrl!}
                alt="Uploaded card"
                className="w-full h-64 object-contain bg-gray-50 rounded-lg"
              />
              <Button
                variant="destructive"
                size="sm"
                className="absolute top-2 right-2"
                onClick={removeImage}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-3 text-sm text-gray-600">
              <p className="font-medium">{uploadedImage.name}</p>
              <p className="text-xs text-gray-400">
                {(uploadedImage.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <input
        id="file-input"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
};

const ImageUploadComponent = memo(ImageUploadComponent);

export const ImageUpload = memo(ImageUploadComponent);