import React from "react";

export interface QueryOptions {
  matchCase: boolean;
  matchWord: boolean;
  useRegex: boolean;
}

interface SearchBarProps {
  queryOptions: QueryOptions;
  setQueryOptions: React.Dispatch<React.SetStateAction<QueryOptions>>;
  doSearch: () => void;
  vscode: any;
}

const SearchBar: React.FC<SearchBarProps> = ({
  queryOptions,
  setQueryOptions,
  doSearch,
  vscode,
}) => {
  const toggleOption = (key: keyof QueryOptions) => {
    setQueryOptions({ ...queryOptions, [key]: !queryOptions[key] });
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        id="query"
        type="text"
        placeholder="Search…"
        style={{ flex: 1, padding: 4 }}
        onKeyDown={(e) => e.key === "Enter" && doSearch()}
      />
      <button onClick={doSearch}>Search</button>
      <label>
        <input
          type="checkbox"
          checked={queryOptions.matchCase}
          onChange={() => toggleOption("matchCase")}
        />{" "}
        Match Case
      </label>
      <label>
        <input
          type="checkbox"
          checked={queryOptions.matchWord}
          onChange={() => toggleOption("matchWord")}
        />{" "}
        Match Word
      </label>
      <label>
        <input
          type="checkbox"
          checked={queryOptions.useRegex}
          onChange={() => toggleOption("useRegex")}
        />{" "}
        Use Regex
      </label>
    </div>
  );
};

export default SearchBar;
