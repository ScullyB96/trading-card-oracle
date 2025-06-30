
import { memo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";

interface CardDescriptionProps {
  description: string;
  onDescriptionChange: (description: string) => void;
}

const CardDescriptionComponent = ({ description, onDescriptionChange }: CardDescriptionProps) => {
  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center space-x-2 text-lg">
          <FileText className="h-5 w-5 text-blue-600" />
          <span>Describe Your Card</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Textarea
            placeholder="Enter detailed card information...&#10;&#10;Example:&#10;2023 Topps Chrome Baseball&#10;Player: Mike Trout&#10;Card #: 1&#10;Parallel: Refractor&#10;Condition: Near Mint&#10;Graded: PSA 9"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            className="min-h-[200px] resize-none border-gray-300 focus:border-blue-500 focus:ring-blue-500"
          />
          <div className="text-sm text-gray-500">
            <p className="font-medium mb-2">Include details like:</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Player name and team</li>
              <li>Year, brand, and set</li>
              <li>Card number and parallels</li>
              <li>Condition or grade (if applicable)</li>
              <li>Any special attributes (rookie, autograph, etc.)</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export const CardDescription = memo(CardDescriptionComponent);
