import { ArrowLeft, Menu } from "lucide-react";
import React from "react";

interface PageHeaderProps {
    title: string;
    onBack?: () => void;
    onMenuToggle?: () => void;
    children?: React.ReactNode;
}

export function PageHeader({ title, onBack, onMenuToggle, children }: PageHeaderProps) {
    return (
        <header className="page-header">
            <div className="header-left">
                {onMenuToggle && (
                    <button className="menu-toggle-btn mobile-only" onClick={onMenuToggle} aria-label="Toggle Menu">
                        <Menu size={20} />
                    </button>
                )}
                {onBack && (
                    <button className="back-btn" onClick={onBack}>
                        <ArrowLeft size={14} style={{ marginRight: '8px' }} />
                        Back
                    </button>
                )}
                <h1>{title}</h1>
            </div>
            {children && <div className="header-actions">{children}</div>}
        </header>
    );
}
