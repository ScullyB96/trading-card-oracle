
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calculator } from "lucide-react";

interface CompLogicSelectionProps {
  compLogic: string;
  onCompLogicChange: (logic: string) => void;
}

const compOptions = [
  { 
    value: "lastSale", 
    label: "Last Sale", 
    description: "Most recent sold listing" 
  },
  { 
    value: "average3", 
    label: "Average of 3", 
    description: "Average of last 3 sales" 
  },
  { 
    value: "average5", 
    label: "Average of 5", 
    description: "Average of last 5 sales" 
  },
  { 
    value: "median", 
    label: "Median Price", 
    description: "Middle value of recent sales" 
  },
  { 
    value: "conservative", 
    label: "Conservative (25th percentile)", 
    description: "Lower end estimate for conservative valuation" 
  },
  { 
    value: "mode", 
    label: "Most Common Range", 
    description: "Average of most frequently occurring price range" 
  }
];

export const CompLogicSelection = ({ compLogic, onCompLogicChange }: CompLogicSelectionProps) => {
  const selectedOption = compOptions.find(option => option.value === compLogic);

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-white/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center space-x-2 text-lg">
          <Calculator className="h-5 w-5 text-blue-600" />
          <span>Comparison Logic</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Select value={compLogic} onValueChange={onCompLogicChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select comparison method" />
            </SelectTrigger>
            <SelectContent>
              {compOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div>
                    <div className="font-medium">{option.label}</div>
                    <div className="text-xs text-gray-500">{option.description}</div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {selectedOption && (
            <div className="text-sm text-gray-600 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="font-medium text-blue-800">{selectedOption.label}</p>
              <p className="text-blue-600 text-xs mt-1">{selectedOption.description}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
