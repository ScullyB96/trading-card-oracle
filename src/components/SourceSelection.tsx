
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Globe, Clock, AlertTriangle } from "lucide-react";

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
    description: "Auction tracking (may be slow)",
    status: "available"
  }
];

export const SourceSelection = ({ selectedSources, onSourcesChange }: SourceSelectionProps) => {
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
          <Clock className="h-4 w-4 text-amber-500" />
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
        
        <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-700">
              <p className="font-medium">Performance Improvements:</p>
              <ul className="mt-1 space-y-1">
                <li>• 8-second timeout per request</li>
                <li>• Limited to 4 search variations</li>
                <li>• Stops after 2 successful matches</li>
                <li>• Enhanced error handling</li>
              </ul>
            </div>
          </div>
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
