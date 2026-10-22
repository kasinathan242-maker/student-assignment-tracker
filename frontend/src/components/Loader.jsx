import React from 'react';

const Loader = ({ message = 'Loading...', fullScreen = false }) => {
  return (
    <div className={`loader-container ${fullScreen ? 'loader-fullscreen' : ''}`}>
      <div className="spinner">
        <div className="spinner-inner"></div>
      </div>
      {message && <p className="loader-text">{message}</p>}
    </div>
  );
};

export default Loader;
