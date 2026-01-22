'use client';

interface Condition {
  id: string;
  condition_type: string;
  description: string;
  status: string;
  verified_at: string | null;
  verified_by: string | null;
  metadata: Record<string, any>;
}

interface ConditionChecklistProps {
  conditions: Condition[];
}

export function ConditionChecklist({ conditions }: ConditionChecklistProps) {
  if (conditions.length === 0) {
    return (
      <div className="text-gray-500 text-center py-4">
        No conditions defined for this escrow
      </div>
    );
  }

  const verifiedCount = conditions.filter((c) => c.status === 'verified').length;
  const allVerified = verifiedCount === conditions.length && conditions.length > 0;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
        <span className="text-sm font-medium">
          {verifiedCount} of {conditions.length} conditions verified
        </span>
        {allVerified && (
          <span className="text-sm text-green-600 font-semibold">
            ✅ All conditions met
          </span>
        )}
      </div>

      {/* Conditions List */}
      <div className="space-y-2">
        {conditions.map((condition) => (
          <div
            key={condition.id}
            className={`p-4 rounded-lg border-2 transition-all ${
              condition.status === 'verified'
                ? 'bg-green-50 border-green-200'
                : condition.status === 'rejected'
                ? 'bg-red-50 border-red-200'
                : 'bg-gray-50 border-gray-200'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  {condition.status === 'verified' ? (
                    <span className="text-green-600 text-xl">✓</span>
                  ) : condition.status === 'rejected' ? (
                    <span className="text-red-600 text-xl">✗</span>
                  ) : (
                    <span className="text-gray-400 text-xl">○</span>
                  )}
                  <h3 className="font-semibold">{condition.condition_type}</h3>
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      condition.status === 'verified'
                        ? 'bg-green-100 text-green-800'
                        : condition.status === 'rejected'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {condition.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-700">{condition.description}</p>
                {condition.verified_at && (
                  <p className="mt-2 text-xs text-gray-500">
                    Verified on {new Date(condition.verified_at).toLocaleString()}
                    {condition.verified_by && ` by ${condition.verified_by}`}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
