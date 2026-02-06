import React from "react";
import { bgEmpty } from "../assets/index";

interface EmptyStateProps {
  message?: string;
  children?: React.ReactNode;
}

export function EmptyState({ message = "아직 아무것도 없어요.", children }: EmptyStateProps) {
  return (
    <div className="emptyState">
      <img src={bgEmpty} alt="" className="emptyStateImg" />
      <div className="emptyStateText muted">{message}</div>
      {children}
    </div>
  );
}
