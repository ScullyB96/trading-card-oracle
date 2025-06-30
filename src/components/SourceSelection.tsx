
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Globe } from "lucide-react";

interface SourceSelectionProps {
  selectedSources: string[];
  onSourcesChange: (sources: string[]) => void;
}

const sources = [
  { id: "ebay", name: "eBay", description: "Most comprehensive marketplace" },
  { id: "130point", name: "130point", description: "Auction tracking platform" },
  { id: "goldin", name: "Goldin", description: "High-end auction house" },
  { id: "pwcc", name: "PWCC", description: "Premier collectibles marketplace" }
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
                  className="text-sm font-medium text-gray-700 cursor-pointer block"
                >
                  {source.name}
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
