import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Globe } from "lucide-react";

interface SourceSelectionProps {
  selectedSources: string[];
  onSourcesChange: (sources: string[]) => void;
}

const sources = [
  { 
    id: "ebay", 
    name: "eBay", 
    description: "Sold listings with timeout protection",
    status: "optimized"
  },
  { 
    id: "130point", 
    name: "130point", 
    description: "Auction tracking with strict validation",
    status: "available"
  }
];

const SourceSelectionComponent = ({ selectedSources, onSourcesChange }: SourceSelectionProps) => {
  const handleSourceToggle = (sourceId: string) => {
    if (selectedSources.includes(sourceId)) {
      onSourcesChange(selectedSources.filter(id => id !== sourceId));
    } else {
      onSourcesChange([...selectedSources, sourceId]);
    }
  };

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-white/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center space-x-2 text-lg">
          <Globe className="h-5 w-5 text-blue-600" />
          <span>Data Sources</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sources.map((source) => (
            <div key={source.id} className="flex items-start space-x-3">
              <Checkbox
                id={source.id}
                checked={selectedSources.includes(source.id)}
                onCheckedChange={() => handleSourceToggle(source.id)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <label
                  htmlFor={source.id}
                  className="text-sm font-medium text-gray-700 cursor-pointer block flex items-center gap-2"
                >
                  {source.name}
                  {source.status === "optimized" && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      Fast
                    </span>
                  )}
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  {source.description}
                </p>
              </div>
            </div>
          ))}
        </div>
        
        {selectedSources.length === 0 && (
          <p className="text-sm text-amber-600 mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
            Please select at least one data source
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export const SourceSelection = memo(SourceSelectionComponent);