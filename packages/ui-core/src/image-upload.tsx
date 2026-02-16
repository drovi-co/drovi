import { Loader2, Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./button";

interface ImageUploadProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  onUpload?: (file: File) => Promise<string>;
  disabled?: boolean;
  maxSizeKB?: number;
  accept?: string;
  className?: string;
  placeholder?: React.ReactNode;
}

export function ImageUpload({
  value,
  onChange,
  onUpload,
  disabled = false,
  maxSizeKB = 500,
  accept = "image/*",
  className = "",
  placeholder,
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      // Validate file type
      if (!file.type.startsWith("image/")) {
        toast.error("Please select an image file");
        return;
      }

      // Validate file size
      const maxSizeBytes = maxSizeKB * 1024;
      if (file.size > maxSizeBytes) {
        toast.error(`Image must be smaller than ${maxSizeKB}KB`);
        return;
      }

      setIsUploading(true);

      try {
        let imageUrl: string;

        if (onUpload) {
          // Use custom upload handler
          imageUrl = await onUpload(file);
        } else {
          // Convert to base64 data URL for small images
          imageUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("Failed to read file"));
            reader.readAsDataURL(file);
          });
        }

        onChange(imageUrl);
        toast.success("Image uploaded successfully");
      } catch (error) {
        console.error("Upload error:", error);
        toast.error("Failed to upload image");
      } finally {
        setIsUploading(false);
        // Reset input
        if (inputRef.current) {
          inputRef.current.value = "";
        }
      }
    },
    [maxSizeKB, onChange, onUpload]
  );

  const handleRemove = useCallback(() => {
    onChange(null);
  }, [onChange]);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {value ? (
        <div className="relative">
          <img
            alt="Uploaded preview"
            className="h-16 w-16 rounded-lg object-cover"
            height={64}
            src={value}
            width={64}
          />
          {!disabled && (
            <Button
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
              onClick={handleRemove}
              size="icon"
              type="button"
              variant="destructive"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
          {placeholder || <Upload className="h-6 w-6 text-muted-foreground" />}
        </div>
      )}
      <div>
        <input
          accept={accept}
          className="hidden"
          disabled={disabled || isUploading}
          onChange={handleFileChange}
          ref={inputRef}
          type="file"
        />
        <Button
          disabled={disabled || isUploading}
          onClick={handleClick}
          type="button"
          variant="outline"
        >
          {isUploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : value ? (
            "Change Image"
          ) : (
            "Upload Image"
          )}
        </Button>
        <p className="mt-1 text-muted-foreground text-sm">
          Max size: {maxSizeKB}KB
        </p>
      </div>
    </div>
  );
}

export default ImageUpload;
